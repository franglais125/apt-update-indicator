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
    Copyright 2016 Fran Glais
*/

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;

const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;

const Util = imports.misc.util;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const Format = imports.format;
const Gettext = imports.gettext.domain('apt-update-indicator');
const _ = Gettext.gettext;

/* For error checking */
const STATUS = {
    UNKNOWN:     -1,
    ERROR:       -2,
    NO_INTERNET: -3
};

/* Options */
const STOCK_CHECK_CMD    = '/usr/bin/pkcon refresh';
const STOCK_UPDATE_CMD   = '/usr/bin/gnome-software --mode updates';
let CHECK_CMD            = STOCK_CHECK_CMD;
let UPDATE_CMD           = STOCK_UPDATE_CMD;

/* Variables we want to keep when extension is disabled (eg during screen lock) */
let UPDATES_PENDING        = STATUS.UNKNOWN;
let UPDATES_LIST           = [];

/* Various packages statuses */
const SCRIPT_NAMES = ['get-updates', 'new', 'obsolete', 'residual', 'autoremovable'];
const PKG_STATUS = {
    UPGRADABLE:    0,
    NEW:           1,
    OBSOLETE:      2,
    RESIDUAL:      3,
    AUTOREMOVABLE: 4
};

function init() {
    String.prototype.format = Format.format;
    Utils.initTranslations("apt-update-indicator");
}

const AptUpdateIndicator = new Lang.Class({
    Name: 'AptUpdateIndicator',
    Extends: PanelMenu.Button,

    _TimeoutId: null,

    _upgradeProcess_sourceId: null,
    _upgradeProcess_stream: null,

    _process_sourceId: [null, null, null, null],
    _process_stream: [null, null, null, null],

    _updateList: [],
    _newPackagesList: [],
    _obsoletePackagesList: [],
    _residualPackagesList: [],
    _autoremovablePackagesList: [],

    _init: function() {
        this.parent(0.0, "AptUpdateIndicator");

        this.updateIcon = new St.Icon({icon_name: 'system-software-install-symbolic', style_class: 'system-status-icon'});

        let box = new St.BoxLayout({ vertical: false, style_class: 'panel-status-menu-box' });
        this.label = new St.Label({ text: '',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER });
        this.label.visible = false;

        box.add_child(this.updateIcon);
        box.add_child(this.label);
        this.actor.add_child(box);

        // Prepare to track connections
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        // Assemble the menu
        this._assembleMenu();

        // Load settings
        this._settings = Utils.getSettings();
        this._applySettings();

        // The first run is initialization only: we only read the existing files
        this._initializing = true;
        this._otherPackages(false, PKG_STATUS.UPGRADABLE);

        // We check for the network status before trying to update apt-cache
        this._network_monitor = Gio.network_monitor_get_default();
        this._signalsHandler.add([this._network_monitor,
                                 'network-changed',
                                 Lang.bind(this, this._checkConnectionState)]);
        this._checkConnectionState();
        this._startFolderMonitor();
    },

    _openSettings: function () {
        Util.spawn([ "gnome-shell-extension-prefs", Me.uuid ]);
    },

    _assembleMenu: function() {
        // Prepare the special menu : a submenu for updates list that will look like a regular menu item when disabled
        // Scrollability will also be taken care of by the popupmenu
        this.updatesExpander = new PopupMenu.PopupSubMenuMenuItem('');
        this.updatesListMenuLabel = new St.Label();
        this.updatesExpander.menu.box.add(this.updatesListMenuLabel);
        this.updatesExpander.menu.box.style_class = 'apt-update-indicator-list';

        this.newPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('New in repository'));
        this.newPackagesListMenuLabel = new St.Label();
        this.newPackagesExpander.menu.box.add(this.newPackagesListMenuLabel);
        this.newPackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.newPackagesExpander.actor.visible = false;

        this.obsoletePackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Local/Obsolete packages'));
        this.obsoletePackagesListMenuLabel = new St.Label();
        this.obsoletePackagesExpander.menu.box.add(this.obsoletePackagesListMenuLabel);
        this.obsoletePackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.obsoletePackagesExpander.actor.visible = false;

        this.residualPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Residual config files'));
        this.residualPackagesListMenuLabel = new St.Label();
        this.residualPackagesExpander.menu.box.add(this.residualPackagesListMenuLabel);
        this.residualPackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.residualPackagesExpander.actor.visible = false;

        this.autoremovablePackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Autoremovable'));
        this.autoremovablePackagesListMenuLabel = new St.Label();
        this.autoremovablePackagesExpander.menu.box.add(this.autoremovablePackagesListMenuLabel);
        this.autoremovablePackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.autoremovablePackagesExpander.actor.visible = false;

        // Other standard menu items
        let settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
        this.updateNowMenuItem = new PopupMenu.PopupMenuItem(_('Apply updates'));

        // "Check now" and "Last Check" menu items
        this.checkNowMenuItem = new PopupMenu.PopupMenuItem( _('Check now') );
        this.lastCheckMenuItem = new PopupMenu.PopupMenuItem( '' );
        this.lastCheckMenuItem.actor.reactive = false;
        this.lastCheckMenuItem.actor.visible = false;

        // Assemble all menu items into the popup menu
        this.menu.addMenuItem(this.updatesExpander);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.newPackagesExpander);
        this.menu.addMenuItem(this.obsoletePackagesExpander);
        this.menu.addMenuItem(this.residualPackagesExpander);
        this.menu.addMenuItem(this.autoremovablePackagesExpander);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.updateNowMenuItem);
        this.menu.addMenuItem(this.checkNowMenuItem);
        this.menu.addMenuItem(this.lastCheckMenuItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(settingsMenuItem);

        // Bind some events
        this._signalsHandler.add([
            this.menu,
            'open-state-changed',
            Lang.bind(this, this._onMenuOpened)
        ],[
            this.checkNowMenuItem,
            'activate',
            Lang.bind(this, this._checkUpdates)
        ],[
            this.updateNowMenuItem,
            'activate',
            Lang.bind(this, this._updateNow)
        ],[
            settingsMenuItem,
            'activate',
            Lang.bind(this, this._openSettings)
        ]);
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
        } else if (option == 3 && this._settings.get_string('update-cmd') !== "") {
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
            this._settings.get_string('check-cmd-custom') !== "")
            CHECK_CMD = '/usr/bin/pkexec ' + this._settings.get_string('check-cmd-custom');
        else
            CHECK_CMD = STOCK_CHECK_CMD;
    },

    _startFolderMonitor: function() {
        let directory = '/var/lib/apt/lists';
        this.apt_dir = Gio.file_new_for_path(directory);
        this.monitor = this.apt_dir.monitor_directory(0, null, null);
        this._signalsHandler.add([this.monitor,
                                 'changed',
                                 Lang.bind(this, this._onFolderChanged)]);
    },

    _onFolderChanged: function() {
        // Apt cache has changed! Let's schedule a check in a few seconds
        if (this._folderMonitorId)
            GLib.source_remove(this._folderMonitorId);
        let timeout = 60;
        this._folderMonitorId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                                        timeout,
                                                        Lang.bind(this, function () {
                                                            let initializing = false;
                                                            this._otherPackages(initializing, PKG_STATUS.UPGRADABLE);
                                                            this._folderMonitorId = null;
                                                            return false;
                                                        }));
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
                                                               this._checkUpdates();
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
                                                               this._checkUpdates();
                                                               return true;
                                                       }));
        }

    },

    _newPackagesBinding: function() {
        if (this._settings.get_boolean('new-packages')) {
            this._otherPackages(this._initializing, PKG_STATUS.NEW);
        } else {
            this._newPackagesList = [];
            this._updateNewPackagesStatus();
        }
    },

    _obsoletePackagesBinding: function() {
        if (this._settings.get_boolean('obsolete-packages')) {
            this._otherPackages(this._initializing, PKG_STATUS.OBSOLETE);
        } else {
            this._obsoletePackagesList = [];
            this._updateObsoletePackagesStatus();
        }
    },

    _residualPackagesBinding: function() {
        if (this._settings.get_boolean('residual-packages')) {
            this._otherPackages(this._initializing, PKG_STATUS.RESIDUAL);
        } else {
            this._residualPackagesList = [];
            this._updateResidualPackagesStatus();
        }
    },

    _autoremovablePackagesBinding: function() {
        if (this._settings.get_boolean('autoremovable-packages')) {
            this._otherPackages(this._initializing, PKG_STATUS.AUTOREMOVABLE);
        } else {
            this._autoremovablePackagesList = [];
            this._updateAutoremovablePackagesStatus();
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
            'changed::show-count',
            Lang.bind(this, this._checkShowHideIndicator)
        ],[
            this._settings,
            'changed::always-visible',
            Lang.bind(this, this._checkShowHideIndicator)
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
        ]);
    },

    _checkConnectionState: function() {
        let url = 'http://ftp.debian.org';
        let address = Gio.NetworkAddress.parse_uri(url, 80);
        let cancellable = Gio.Cancellable.new();
        this._connected = false;
        try {
            this._network_monitor.can_reach_async(address, cancellable, Lang.bind(this, this._asyncReadyCallback));
        } catch (err) {
            let title = _("Can not connect to %s").format(url);
            log(title + '\n' + err.message);
        }
    },

    _asyncReadyCallback: function(nm, res) {
        this._connected = this._network_monitor.can_reach_finish(res);
    },

    destroy: function() {
        // Remove remaining processes to avoid zombies
        if (this._upgradeProcess_sourceId) {
            GLib.source_remove(this._upgradeProcess_sourceId);
            this._upgradeProcess_sourceId = null;
            this._upgradeProcess_stream = null;
        }
        for (let i = 0; i < PKG_STATUS.length; i++)
            if (this._process_sourceId[i]) {
                GLib.source_remove(this._process_sourceId[i]);
                this._process_sourceId[i] = null;
                this._process_stream[i] = null;
            }
        if (this._TimeoutId) {
            GLib.source_remove(this._TimeoutId);
            this._TimeoutId = null;
        }

        // Disconnect global signals
        this._signalsHandler.destroy();

        this.parent();
    },

    /* Menu functions:
     *     _lastCheck
     *     _checkShowHideIndicator
     *     _onMenuOpened
     *     _checkAutoExpandList
     *     _showChecking
     *     _updateStatus
     *     _updatePackagesStatus
     *     _updateNewPackagesStatus
     *     _updateObsoletePackagesStatus
     *     _updateResidualPackagesStatus
     *     _updateAutoremovablePackagesStatus
     *     _updateMenuExpander
     */

    _lastCheck: function() {
        let date;

        if (this._initializing) {
            let last_check = new Date(this._settings.get_double('last-check-date-double'));
            date = last_check.toLocaleFormat("%a %b %d, %H:%M").toString();
        } else {
            let now = new Date();
            date = now.toLocaleFormat("%a %b %d, %H:%M").toString();
            this._settings.set_double('last-check-date-double', now);
            if (this._isAutomaticCheck) {
                this._settings.set_double('last-check-date-automatic-double', now);
                this._isAutomaticCheck = false;
            }
        }

        if (date != '') {
            this.lastCheckMenuItem.label.set_text(_('Last check: ') + date);
            this.lastCheckMenuItem.actor.visible = true;
        }
    },

    _checkShowHideIndicator: function() {
        if ( this._upgradeProcess_sourceId )
            // Do not apply visibility change while checking for updates
            return;

        if (!this._settings.get_boolean('always-visible') && this._updateList.length < 1)
            this.actor.visible = false;
        else
            this.actor.visible = true;

        this.label.visible = this._settings.get_boolean('show-count') &&
                             this._updateList.length > 0;
    },

    _onMenuOpened: function() {
        // This event is fired when menu is shown or hidden
        // Only open the submenu if the menu is being opened and there is something to show
        this._checkAutoExpandList();
    },

    _checkAutoExpandList: function() {
        let count = this._updateList.length;
        if (this.menu.isOpen &&
            count > 0 &&
            count <= this._settings.get_int('auto-expand-list')) {
            this.updatesExpander.setSubmenuShown(true);
        } else {
            this.updatesExpander.setSubmenuShown(false);
        }
    },

    _showChecking: function(isChecking) {
        if (isChecking == true) {
            this.updateIcon.set_icon_name('emblem-synchronizing-symbolic');
            this.checkNowMenuItem.actor.reactive = false;
            this.checkNowMenuItem.label.set_text(_('Checking'));
        } else {
            this.checkNowMenuItem.actor.reactive = true;
            this.checkNowMenuItem.label.set_text(_('Check now'));
        }
    },

    _updateStatus: function(updatesCount) {
        updatesCount = typeof updatesCount === 'number' ? updatesCount : this._updateList.length;
        if (updatesCount > 0) {
            // Update indicator look:
            this.updateIcon.set_icon_name('software-update-available');
            this.label.set_text(updatesCount.toString());

            // Update the menu look:
            this._cleanUpgradeList();
            this.updatesListMenuLabel.set_text( this._updateList.join("   \n") );
            this._updateMenuExpander( true, Gettext.ngettext( "%d update pending",
                                                              "%d updates pending",
                                                              updatesCount ).format(updatesCount) );

            // Emit a notification if necessary
            if (this._settings.get_boolean('notify') && UPDATES_PENDING < updatesCount)
                this._notify(updatesCount);

            // Store the new list
            UPDATES_LIST = this._updateList;
        } else {
            // Update the indicator look:
            this.label.set_text('');

            // Update the menu look:
            this.updatesListMenuLabel.set_text("");

            if (updatesCount == STATUS.UNKNOWN) {
                // This is the value of UPDATES_PENDING at initialization.
                // For some reason, the update process didn't work at all
                this.updateIcon.set_icon_name('dialog-warning-symbolic');
                this._updateMenuExpander( false, '' );
            } else if (updatesCount == STATUS.ERROR) {
                // Error
                this.updateIcon.set_icon_name('dialog-warning-symbolic');
                this._updateMenuExpander( false, _('Error') );
            } else if (updatesCount == STATUS.NO_INTERNET) {
                // Error
                this.updateIcon.set_icon_name('dialog-warning-symbolic');
                this._updateMenuExpander( false, _('No internet') );
            } else {
                // Up to date
                this.updateIcon.set_icon_name('system-software-install-symbolic');
                this._updateMenuExpander( false, _('Up to date :)') );
                UPDATES_LIST = []; // Reset stored list
            }
        }

        UPDATES_PENDING = updatesCount;
        this._checkAutoExpandList();
        this._checkShowHideIndicator();
    },

    _notify: function(updatesCount) {
        if (this._settings.get_int('verbosity') > 0) {
            let updateList = [];
            if (this._settings.get_int('verbosity') > 1) {
                updateList = this._updateList;
            } else {
                // Keep only packets that was not in the previous notification
                updateList = this._updateList.filter(function(pkg) { return UPDATES_LIST.indexOf(pkg) < 0 });
            }

            // Replace tab with one space
            updateList = this._updateList.map(function(p) {
                return p.replace("\t", " ");
            });

            if (updateList.length > 50)
                // We show a maximum of 50 updates on the notification, as it can
                // freeze the shell if the text is too long
                updateList = updateList.slice(0, 50);

            if (updateList.length > 0) {
                // Show notification only if there's new updates
                this._showNotification(
                    Gettext.ngettext( "New Update", "New Updates", updateList.length ),
                    updateList.join(', ')
                );
            }

        } else {
            this._showNotification(
                Gettext.ngettext( "New Update", "New Updates", updatesCount ),
                Gettext.ngettext( "There is %d update pending", "There are %d updates pending", updatesCount ).format(updatesCount)
            );
        }
    },

    _cleanUpgradeList: function() {
        if (this._settings.get_boolean('strip-versions') == true) {
            this._updateList = this._updateList.map(function(p) {
                // example: firefox 50.0-1
                // chunks[0] is the package name
                // chunks[1] is the version
                var chunks = p.split("\t",2);
                return chunks[0];
            });
        }
    },

    _updatePackagesStatus: function(index) {
        if (index == PKG_STATUS.UPGRADABLE)
            this._updateStatus(this._updateList.length);
        else if (index == PKG_STATUS.NEW)
            this._updateNewPackagesStatus();
        else if (index == PKG_STATUS.OBSOLETE)
            this._updateObsoletePackagesStatus();
        else if (index == PKG_STATUS.RESIDUAL)
            this._updateResidualPackagesStatus();
        else if (index == PKG_STATUS.AUTOREMOVABLE)
            this._updateAutoremovablePackagesStatus();
    },

    _updateNewPackagesStatus: function() {
        if (this._newPackagesList.length == 0) {
            this.newPackagesExpander.actor.visible = false;
        } else {
            this.newPackagesListMenuLabel.set_text( this._newPackagesList.join("\n") );
            this.newPackagesExpander.actor.visible = true;
        }
    },

    _updateObsoletePackagesStatus: function() {
        if (this._obsoletePackagesList.length == 0)
            this.obsoletePackagesExpander.actor.visible = false;
        else {
            this.obsoletePackagesListMenuLabel.set_text( this._obsoletePackagesList.join("\n") );
            this.obsoletePackagesExpander.actor.visible = true;
        }
    },

    _updateResidualPackagesStatus: function() {
        if (this._residualPackagesList.length == 0)
            this.residualPackagesExpander.actor.visible = false;
        else {
            this.residualPackagesListMenuLabel.set_text( this._residualPackagesList.join("\n") );
            this.residualPackagesExpander.actor.visible = true;
        }
    },

    _updateAutoremovablePackagesStatus: function() {
        if (this._autoremovablePackagesList.length == 0)
            this.autoremovablePackagesExpander.actor.visible = false;
        else {
            this.autoremovablePackagesListMenuLabel.set_text( this._autoremovablePackagesList.join("\n") );
            this.autoremovablePackagesExpander.actor.visible = true;
        }
    },

    _updateMenuExpander: function(enabled, label) {
        if (label == "") {
            // No text, hide the menuitem
            this.updatesExpander.actor.visible = false;
        } else {
        // We make our expander look like a regular menu label if disabled
            this.updatesExpander.actor.reactive = enabled;
            this.updatesExpander._triangle.visible = enabled;
            this.updatesExpander.label.set_text(label);
            this.updatesExpander.actor.visible = true;
        }

        // 'Update now' visibility is linked so let's save a few lines and set it here
        this.updateNowMenuItem.actor.reactive = enabled;
    },

    /* Upgrade functions:
     *     _updateNow
     *     _updateNowEnd
     */

    _updateNow: function () {
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
            this._upgradeProcess_sourceId = GLib.child_watch_add(0, pid, Lang.bind(this, this._updateNowEnd));
        } catch (err) {
        }
    },

    _updateNowEnd: function() {
        // Free resources
        if (this._upgradeProcess_sourceId)
            GLib.source_remove(this._upgradeProcess_sourceId);
        this._upgradeProcess_sourceId = null;

        // Check if updates are available
        this._otherPackages(false, PKG_STATUS.UPGRADABLE);
    },

    /* Update functions:
     *     _checkUpdates
     *     _checkUpdatesEnd
     */

    _checkUpdates: function() {
        if(this._upgradeProcess_sourceId) {
            // A check is already running ! Maybe we should kill it and run another one ?
            return;
        }
        // Run asynchronously, to avoid  shell freeze - even for a 1s check
        this._showChecking(true);
        try {
            // First, check network access
            if (this._connected) {
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
            } else {
                this._showChecking(false);
                this._updateStatus(STATUS.NO_INTERNET);
            }
        } catch (err) {
            this._showChecking(false);
            this._updateStatus(STATUS.ERROR);
        }
    },

    _checkUpdatesEnd: function() {
        // Free resources
        if (this._upgradeProcess_sourceId)
            GLib.source_remove(this._upgradeProcess_sourceId);
        this._upgradeProcess_sourceId = null;

        // Update indicator
        this._otherPackages(false, PKG_STATUS.UPGRADABLE);
    },

    /* Extra packages functions:
     *     _packagesRead
     *     _packagesEnd
     */

    _otherPackages: function(initializing, index) {
        // Run asynchronously, to avoid  shell freeze - even for a 1s check
        try {
            let path = Me.dir.get_path();
            let script = ['/bin/bash', path + '/scripts/' + SCRIPT_NAMES[index] + '.sh',
                          initializing ? '1' : '0'];

            let [, pid, , out_fd, ] = GLib.spawn_async_with_pipes(null,
                                                                  script,
                                                                  null,
                                                                  GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                                  null);

            // Let's buffer the command's output - that's a input for us !
            this._process_stream[index] = new Gio.DataInputStream({
                base_stream: new Gio.UnixInputStream({fd: out_fd})
            });

            // We will process the output at once when it's done
            this._process_sourceId[index] = GLib.child_watch_add(0, pid, Lang.bind(this,
                function() {
                    this._packagesRead(index);
                    return true;
                }));
        } catch (err) {
            if (index == PKG_STATUS.UPGRADABLE) {
                this._showChecking(false);
                this._updateStatus(STATUS.ERROR);
            }
        }
    },

    _packagesRead: function(index) {
        // Reset the new packages list
        let packagesList = [];
        let out, size;
        do {
            [out, size] = this._process_stream[index].read_line_utf8(null);
            if (out) packagesList.push(out);
        } while (out);

        if (index == PKG_STATUS.UPGRADABLE)
            this._updateList = packagesList;
        else if (index == PKG_STATUS.NEW)
            this._newPackagesList = packagesList;
        else if (index == PKG_STATUS.OBSOLETE)
            this._obsoletePackagesList = packagesList;
        else if (index == PKG_STATUS.RESIDUAL)
            this._residualPackagesList = packagesList;
        else if (index == PKG_STATUS.AUTOREMOVABLE)
            this._autoremovablePackagesList = packagesList;

        this._packagesEnd(index);
    },

    _packagesEnd: function(index) {
        // Free resources
        this._process_stream  [index].close(null);
        this._process_stream  [index] = null;
        if (this._process_sourceId[index])
            GLib.source_remove(this._process_sourceId[index]);
        this._process_sourceId[index] = null;

        // Update indicator
        this._updatePackagesStatus(index);

        if (index == PKG_STATUS.UPGRADABLE) {
            // Update indicator
            this._showChecking(false);

            // Update time on menu
            this._lastCheck();

            // Launch other checks
            if (this._settings.get_boolean('new-packages'))
                this._otherPackages(this._initializing, PKG_STATUS.NEW);
            if (this._settings.get_boolean('obsolete-packages'))
                this._otherPackages(this._initializing, PKG_STATUS.OBSOLETE);
            if (this._settings.get_boolean('residual-packages'))
                this._otherPackages(this._initializing, PKG_STATUS.RESIDUAL);
            if (this._settings.get_boolean('autoremovable-packages'))
                this._otherPackages(this._initializing, PKG_STATUS.AUTOREMOVABLE);
            this._initializing = false;
        }
    },

    /*
     * Notifications
     * */

    _showNotification: function(title, message) {
        if (this._notifSource == null) {
            // We have to prepare this only once
            this._notifSource = new MessageTray.SystemNotificationSource();
            this._notifSource.createIcon = function() {
                return new St.Icon({ icon_name: 'system-software-install-symbolic' });
            };
            // Take care of not leaving unneeded sources
            this._notifSource.connect('destroy', Lang.bind(this, function() {this._notifSource = null;}));
            Main.messageTray.add(this._notifSource);
        }
        let notification = null;
        // We do not want to have multiple notifications stacked
        // instead we will update previous
        if (this._notifSource.notifications.length == 0) {
            notification = new MessageTray.Notification(this._notifSource, title, message);
            notification.addAction( _('Update now') , Lang.bind(this, function() {this._updateNow()}) );
        } else {
            notification = this._notifSource.notifications[0];
            notification.update( title, message, { clear: true });
        }
        notification.setTransient(this._settings.get_boolean('transient'));
        this._notifSource.notify(notification);
    },


});

let aptUpdateIndicator;

function enable() {
    aptUpdateIndicator = new AptUpdateIndicator();
    Main.panel.addToStatusArea('AptUpdateIndicator', aptUpdateIndicator);
}

function disable() {
    aptUpdateIndicator.destroy();
}
