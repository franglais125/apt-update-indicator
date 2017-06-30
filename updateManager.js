/*
    This file is part of Apt Update Indicator
    Apt Update Indicator is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    Apt Update Indicator is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with Apt Update Indicator.  If not, see <http://www.gnu.org/licenses/>.
    Copyright 2016 Raphael Rochet
    Copyright 2016, 2017 Fran Glais
*/

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Util = imports.misc.util;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Indicator = Me.imports.indicator;
const Monitors = Me.imports.monitors;
const Prefs = Me.imports.prefs;
const Utils = Me.imports.utils;

const Gettext = imports.gettext.domain('apt-update-indicator');
const _ = Gettext.gettext;

/* Options */
const STOCK_CHECK_CMD  = '/usr/bin/pkcon refresh';
const STOCK_UPDATE_CMD = '/usr/bin/gnome-software --mode updates';
let CHECK_CMD          = STOCK_CHECK_CMD;
let UPDATE_CMD         = STOCK_UPDATE_CMD;

/* Various packages statuses */
const SCRIPT = {
    UPGRADES:      0,
    NEW:           1,
    OBSOLETE:      2,
    RESIDUAL:      3,
    AUTOREMOVABLE: 4
};

/* For error checking */
const STATUS = Indicator.STATUS;

const UpdateManager = new Lang.Class({
    Name: 'UpdateManager',

    _TimeoutId: null,

    _initialTimeoutId: null,

    _upgradeProcess_sourceId: null,
    _upgradeProcess_stream: null,

    _process_sourceId: [null, null, null, null, null],
    _process_stream:   [null, null, null, null, null],

    _init: function() {
        // Create indicator on the panel and initialize it
        this._indicator = new Indicator.AptUpdateIndicator(this);
        this._indicator.updateStatus(STATUS.INITIALIZING);

        // Prepare to track connections
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        // The first run is initialization only: we only read the existing files
        this._initializing = true;

        // We don't update the date in some cases:
        //  - updates check comes from a folder change
        //  - after applying updates
        this._dontUpdateDate = false;

        // Load settings
        this._settings = Utils.getSettings();
        this._applySettings();

        // Start network and directory monitors
        this._netMonitor = new Monitors.NetworkMonitor(this);
        this._dirMonitor = new Monitors.DirectoryMonitor(this);

        // Initial run. We wait 30 seconds before listing the upgrades, this:
        //  - allows a smoother initialization
        //  - lets the async calls finish in case of a quick disable/enable loop
        let initialRunTimeout = 30;
        this._initialTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                                          initialRunTimeout,
                                                          Lang.bind(this, function() {
                                                                  this._launchScript(SCRIPT.UPGRADES);
                                                                  this._initialTimeoutId = null;
                                                                  return false;
                                                          }));

        this._ignoreListTimeoutId = 0
    },

    _applySettings: function() {
        // Parse the various commands
        this._updateCMD();
        this._checkCMD();

        // Add a check at intervals
        this._initializeInterval();

        this._bindSettings();
    },

    _updateCMD: function() {
        let option = this._settings.get_enum('update-cmd-options');
        if (option == 1) {
            // Update manager, Ubuntu only
            UPDATE_CMD = '/usr/bin/update-manager';
        } else if (option == 2) {
            // Gnome Update Viewer: depends on pacakge-kit
            UPDATE_CMD = '/usr/bin/gpk-update-viewer';
        } else if (option == 3 && this._settings.get_string('update-cmd') !== '') {
            // Custom command
            if (this._settings.get_boolean('output-on-terminal')) {
                UPDATE_CMD = '/usr/bin/' + this._settings.get_string('terminal') +
                             ' "echo ' + this._settings.get_string('update-cmd') +
                             '; '      + this._settings.get_string('update-cmd') +
                             '; echo Press any key to continue' +
                             '; read -n1 key"';
            } else {
                UPDATE_CMD = '/usr/bin/' + this._settings.get_string('update-cmd');
            }
        } else {
            // Default, or in case the command is empty, Gnome-Software
            UPDATE_CMD = STOCK_UPDATE_CMD;
        }
    },

    _checkCMD: function() {
        if (this._settings.get_boolean('use-custom-cmd') &&
            this._settings.get_string('check-cmd-custom') !== '')
            CHECK_CMD = '/usr/bin/pkexec ' + this._settings.get_string('check-cmd-custom');
        else
            CHECK_CMD = STOCK_CHECK_CMD;
    },

    _initializeInterval: function() {
        this._isAutomaticCheck = false;

        // Remove the periodic check before adding a new one
        if (this._TimeoutId)
            GLib.source_remove(this._TimeoutId);

        // Interval in hours from settings, convert to seconds
        let unit = this._settings.get_enum('interval-unit');
        let conversion = 0;

        switch (unit) {
        case 0: // Hours
            conversion = 60 * 60;
            break;
        case 1: // Days
            conversion = 60 * 60 * 24;
            break;
        case 2: // Weeks
            conversion = 60 * 60 * 24 * 7;
            break;
        }

        let CHECK_INTERVAL = conversion * this._settings.get_int('check-interval');

        if (CHECK_INTERVAL) {
            // This has to be relative to the last check!
            // Date is in milliseconds, convert to seconds
            let last_check = this._settings.get_double('last-check-date-automatic-double');
            let now = new Date();
            let elapsed = (now - last_check)/1000; // In seconds

            CHECK_INTERVAL -= elapsed;
            if (CHECK_INTERVAL < 0) {
                if (this._initializing)
                    // Wait 2 minutes if just initialized, i.e. after boot or
                    // unlock screen
                    CHECK_INTERVAL = 120;
                else
                    CHECK_INTERVAL = 10;
            }

            this._TimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                                       CHECK_INTERVAL,
                                                       Lang.bind(this, function() {
                                                               this._isAutomaticCheck = true;
                                                               this._checkNetwork();
                                                               this._checkInterval();
                                                               return true;
                                                       }));
        }
    },

    _checkInterval: function() {
        // Remove the periodic check before adding a new one
        if (this._TimeoutId)
            GLib.source_remove(this._TimeoutId);

        let CHECK_INTERVAL = this._settings.get_int('check-interval') * 60 * 60;
        if (CHECK_INTERVAL) {
            this._TimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                                       CHECK_INTERVAL,
                                                       Lang.bind(this, function() {
                                                               this._isAutomaticCheck = true;
                                                               this._checkNetwork();
                                                               return true;
                                                       }));
        }

    },

    _newPackagesBinding: function() {
        if (this._settings.get_boolean('new-packages')) {
            this._launchScript(SCRIPT.NEW);
        } else {
            this._indicator._newPackagesList = [];
            this._indicator._updateNewPackagesStatus();
        }
    },

    _obsoletePackagesBinding: function() {
        if (this._settings.get_boolean('obsolete-packages')) {
            this._launchScript(SCRIPT.OBSOLETE);
        } else {
            this._indicator._obsoletePackagesList = [];
            this._indicator._updateObsoletePackagesStatus();
        }
    },

    _residualPackagesBinding: function() {
        if (this._settings.get_boolean('residual-packages')) {
            this._launchScript(SCRIPT.RESIDUAL);
        } else {
            this._indicator._residualPackagesList = [];
            this._indicator._updateResidualPackagesStatus();
        }
    },

    _autoremovablePackagesBinding: function() {
        if (this._settings.get_boolean('autoremovable-packages')) {
            this._launchScript(SCRIPT.AUTOREMOVABLE);
        } else {
            this._indicator._autoremovablePackagesList = [];
            this._indicator._updateAutoremovablePackagesStatus();
        }
    },

    _bindSettings: function() {
        this._signalsHandler.add([
        // Apply updates
            this._settings,
            'changed::update-cmd-options',
            Lang.bind(this, this._updateCMD)
        ],[
            this._settings,
            'changed::terminal',
            Lang.bind(this, this._updateCMD)
        ],[
            this._settings,
            'changed::output-on-terminal',
            Lang.bind(this, this._updateCMD)
        ],[
            this._settings,
            'changed::update-cmd',
            Lang.bind(this, this._updateCMD)
        ],[
        // Checking for updates
            this._settings,
            'changed::check-cmd-custom',
            Lang.bind(this, this._checkCMD)
        ],[
            this._settings,
            'changed::use-custom-cmd',
            Lang.bind(this, this._checkCMD)
        ],[
        // Basic settings
            this._settings,
            'changed::check-interval',
            Lang.bind(this, this._initializeInterval)
        ],[
        // Basic settings
            this._settings,
            'changed::interval-unit',
            Lang.bind(this, this._initializeInterval)
        ],[
            this._settings,
            'changed::strip-versions',
            Lang.bind(this, function() {this._launchScript(SCRIPT.UPGRADES);})
        ],[
            this._settings,
            'changed::show-critical-updates',
            Lang.bind(this, function() {this._launchScript(SCRIPT.UPGRADES);})
        ],[
            this._settings,
            'changed::ignore-list',
            Lang.bind(this, function() {
                // We add a timeout in case many entries are deleted
                if (this._ignoreListTimeoutId) {
                    GLib.source_remove(this._ignoreListTimeoutId)
                    this._ignoreListTimeoutId = 0;
                }

                this._ignoreListTimeoutId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    5,
                    Lang.bind(this, function() {
                        this._launchScript(SCRIPT.UPGRADES);
                        this._ignoreListTimeoutId = 0;
                        return false;
                    }));
            })
        ],[
        // Synaptic features
            this._settings,
            'changed::new-packages',
            Lang.bind(this, this._newPackagesBinding)
        ],[
            this._settings,
            'changed::obsolete-packages',
            Lang.bind(this, this._obsoletePackagesBinding)
        ],[
            this._settings,
            'changed::residual-packages',
            Lang.bind(this, this._residualPackagesBinding)
        ],[
            this._settings,
            'changed::autoremovable-packages',
            Lang.bind(this, this._autoremovablePackagesBinding)
        ],[
            // Indicator buttons
            this._indicator.checkNowMenuItem,
            'activate',
            Lang.bind(this, this._checkNetwork)
        ],[
            this._indicator.applyUpdatesMenuItem,
            'activate',
            Lang.bind(this, this._applyUpdates)
        ]);
    },

    /* Upgrade functions:
     *     _applyUpdates
     *     _applyUpdatesEnd
     */

    _applyUpdates: function () {
        if(this._upgradeProcess_sourceId) {
            // A check is running ! Maybe we should kill it and run another one ?
            return;
        }
        try {
            // Parse check command line
            let [parseok, argvp] = GLib.shell_parse_argv( UPDATE_CMD );
            if (!parseok) { throw 'Parse error' };
            let [, pid, , , ] = GLib.spawn_async_with_pipes(null,
                                                            argvp,
                                                            null,
                                                            GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                            null);

            // We will process the output at once when it's done
            this._upgradeProcess_sourceId = GLib.child_watch_add(0, pid, Lang.bind(this, this._applyUpdatesEnd));
        } catch (err) {
        }
    },

    _applyUpdatesEnd: function() {
        // Free resources
        if (this._upgradeProcess_sourceId)
            GLib.source_remove(this._upgradeProcess_sourceId);
        this._upgradeProcess_sourceId = null;

        // Check if updates are available
        this._dontUpdateDate = true;
        this._launchScript(SCRIPT.UPGRADES);

        return GLib.SOURCE_REMOVE;
    },

    /* Update functions:
     *     _checkNetwork
     *     networkFailed
     *     checkUpdates
     *     _checkUpdatesEnd
     */

    _checkNetwork: function() {
        this._indicator.showChecking(true);
        this._netMonitor.networkTimeout();
    },

    networkFailed: function() {
        this._indicator.showChecking(false);
        this._indicator.updateStatus(STATUS.NO_INTERNET);
    },

    checkUpdates: function() {
        // Stop the dir monitor to prevent it from updating again right after
        // the update
        this._dirMonitor.stop();

        if(this._upgradeProcess_sourceId) {
            // A check is already running ! Maybe we should kill it and run another one ?
            return;
        }
        // Run asynchronously, to avoid  shell freeze - even for a 1s check
        try {
            // Parse check command line
            let [parseok, argvp] = GLib.shell_parse_argv( CHECK_CMD );
            if (!parseok) { throw 'Parse error' };
            let [, pid, , , ] = GLib.spawn_async_with_pipes(null,
                                                            argvp,
                                                            null,
                                                            GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                            null);

            // We will process the output at once when it's done
            this._upgradeProcess_sourceId = GLib.child_watch_add(0, pid, Lang.bind(this, this._checkUpdatesEnd));
        } catch (err) {
            this._indicator.showChecking(false);
            this._indicator.updateStatus(STATUS.ERROR);
        }
    },

    _checkUpdatesEnd: function() {
        // Free resources
        if (this._upgradeProcess_sourceId)
            GLib.source_remove(this._upgradeProcess_sourceId);
        this._upgradeProcess_sourceId = null;

        // Update indicator
        this._launchScript(SCRIPT.UPGRADES);

        return GLib.SOURCE_REMOVE;
    },

    /* Extra packages functions:
     *     _launchScript
     *     _packagesRead
     *     _packagesEnd
     *     _lastCheck
     */

    _launchScript: function(index) {
        let script_names = ['get-updates',
                            'new',
                            'obsolete',
                            'residual',
                            'autoremovable'];

        // Run asynchronously, to avoid shell freeze - even for a 1s check
        try {
            let path = Me.dir.get_path();
            let script = ['/bin/bash',
                          path + '/scripts/' + script_names[index] + '.sh',
                          this._initializing ? '1' : '0'];

            let [, pid, , out_fd, ] = GLib.spawn_async_with_pipes(null,
                                                                  script,
                                                                  null,
                                                                  GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                                  null);

            // Let's buffer the command's output - that's an input for us !
            this._process_stream[index] = new Gio.DataInputStream({
                base_stream: new Gio.UnixInputStream({fd: out_fd})
            });

            // We will process the output at once when it's done
            this._process_sourceId[index] = GLib.child_watch_add(0, pid, Lang.bind(this,
                function() {
                    this._packagesRead(index);
                }));
        } catch (err) {
            if (index == SCRIPT.UPGRADES) {
                this._indicator.showChecking(false);
                this._indicator.updateStatus(STATUS.ERROR);
            }
        }
    },

    _packagesRead: function(index) {
        // Reset the new packages list
        let packagesList = [];
        let out, size;
        if (this._process_stream[index]) {
            do {
                [out, size] = this._process_stream[index].read_line_utf8(null);
                if (out) packagesList.push(out);
            } while (out);
        }

        // Since this runs async, the indicator might have been destroyed!
        if (this._indicator) {
            if (index == SCRIPT.UPGRADES) {
                packagesList = this._filterList(packagesList);
                this._indicator._updateList = packagesList;
            }
            else if (index == SCRIPT.NEW)
                this._indicator._newPackagesList = packagesList;
            else if (index == SCRIPT.OBSOLETE)
                this._indicator._obsoletePackagesList = packagesList;
            else if (index == SCRIPT.RESIDUAL)
                this._indicator._residualPackagesList = packagesList;
            else if (index == SCRIPT.AUTOREMOVABLE)
                this._indicator._autoremovablePackagesList = packagesList;
        }

        this._packagesEnd(index);
    },

    _packagesEnd: function(index) {
        // Free resources
        if (this._process_stream[index]) {
            this._process_stream[index].close(null);
            this._process_stream[index] = null;
        }
        if (this._process_sourceId[index])
            GLib.source_remove(this._process_sourceId[index]);
        this._process_sourceId[index] = null;

        // Since this runs async, the indicator might have been destroyed!
        if (this._indicator) {
            // Update indicator
            if (index == SCRIPT.UPGRADES && this._settings.get_boolean('show-critical-updates'))
                this._checkUrgency();
            else {
                this._indicator.updatePackagesStatus(index);
                this._indicator._urgentList = [];
            }

            if (index == SCRIPT.UPGRADES) {
                // Update indicator
                this._indicator.showChecking(false);

                // Update time on menu
                this._lastCheck();

                // Launch other checks
                if (this._settings.get_boolean('new-packages'))
                    this._launchScript(SCRIPT.NEW);
                if (this._settings.get_boolean('obsolete-packages'))
                    this._launchScript(SCRIPT.OBSOLETE);
                if (this._settings.get_boolean('residual-packages'))
                    this._launchScript(SCRIPT.RESIDUAL);
                if (this._settings.get_boolean('autoremovable-packages'))
                    this._launchScript(SCRIPT.AUTOREMOVABLE);
                this._initializing = false;

                this._dirMonitor.start();
            }
        }

        return GLib.SOURCE_REMOVE;
    },

    _checkUrgency: function() {
        try {
            let path = Me.dir.get_path();
            let argvp = ['/bin/bash', path + '/scripts/urgency.sh'];

            let [, pid, , out_fd, ] = GLib.spawn_async_with_pipes(null,
                                                            argvp,
                                                            null,
                                                            GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                            null);

            // Let's buffer the command's output - that's an input for us !
            this._urgency_process_stream = new Gio.DataInputStream({
                base_stream: new Gio.UnixInputStream({fd: out_fd})
            });

            // We will process the output at once when it's done
            this._urgencyCheckId = GLib.child_watch_add(0, pid, Lang.bind(this, this._checkUrgencyRead));
        } catch (err) {
        }
    },

    _checkUrgencyRead: function() {
        // Reset the new packages list
        let urgencyList = [];
        let out, size;
        if (this._urgency_process_stream) {
            do {
                [out, size] = this._urgency_process_stream.read_line_utf8(null);
                if (out) urgencyList.push(out);
            } while (out);
        }

        let cleanUrgentList = this._indicator._updateList.filter(function(pkg) {
            for (let i = 0; i < urgencyList.length; i++) {
                // Only get the package name, in case the version is included
                var pkgName = pkg.split('\t',2)[0];
                if (urgencyList[i].indexOf(pkgName + '-') !== -1)
                    return true;
            }
            return false;
        });

        this._indicator._urgentList = cleanUrgentList;
        this._indicator.updatePackagesStatus(SCRIPT.UPGRADES);

        this._checkUrgencyEnd();
    },

    _checkUrgencyEnd: function() {
        // Free resources
        if (this._urgency_process_stream) {
            this._urgency_process_stream.close(null);
            this._urgency_process_stream = null;
        }
        if (this._urgencyCheckId)
            GLib.source_remove(this._urgencyCheckId);
        this._urgencyCheckId = null;
    },

    _lastCheck: function() {
        if (this._dontUpdateDate) {
            this._dontUpdateDate = false;
            return;
        }
        let date;

        if (this._initializing) {
            let last_check = new Date(this._settings.get_double('last-check-date-double'));
            date = last_check.toLocaleFormat('%a %b %d, %H:%M').toString();
        } else {
            let now = new Date();
            date = now.toLocaleFormat('%a %b %d, %H:%M').toString();
            this._settings.set_double('last-check-date-double', now);
            if (this._isAutomaticCheck) {
                this._settings.set_double('last-check-date-automatic-double', now);
                this._isAutomaticCheck = false;
            }
        }

        if (date != '') {
            this._indicator.lastCheckMenuItem.label.set_text(_('Last check: ') + date);
            this._indicator.lastCheckMenuItem.actor.visible = true;
        }
    },

    _filterList: function(packagesList) {
        let ignoreList = this._settings.get_string('ignore-list');
        ignoreList = Prefs.splitEntries(ignoreList);

        return packagesList.filter(function(pkg) {
            // only get the package name, in case the version is included
            var pkgname = pkg.split('\t',2)[0];
            if (ignoreList.indexOf(pkgname) !== -1)
                return false;
            return true;
        });
    },

    destroy: function() {
        // Remove remaining processes to avoid zombies
        if (this._upgradeProcess_sourceId) {
            GLib.source_remove(this._upgradeProcess_sourceId);
            this._upgradeProcess_sourceId = null;
            this._upgradeProcess_stream = null;
        }

        for (let i = 0; i < SCRIPT.length; i++)
            if (this._process_sourceId[i]) {
                GLib.source_remove(this._process_sourceId[i]);
                this._process_sourceId[i] = null;
                this._process_stream[i] = null;
            }

        if (this._TimeoutId) {
            GLib.source_remove(this._TimeoutId);
            this._TimeoutId = null;
        }

        if (this._initialTimeoutId) {
            GLib.source_remove(this._initialTimeoutId);
            this._initialTimeoutId = null;
        }

        // Disconnect global signals
        this._signalsHandler.destroy();

        // Destroy monitors
        this._netMonitor.destroy();
        this._dirMonitor.destroy();

        this._indicator.destroy();
        this._indicator = null;
    }
});
