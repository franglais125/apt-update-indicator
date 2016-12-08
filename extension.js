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
    Copyright 2016 Raphaël Rochet
    Copyright 2016 Fran Glais
*/

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;

const St = imports.gi.St;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;

const Main = imports.ui.main;
const Panel = imports.ui.panel;
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

/* Options */
const PREPEND_CMD        = '/usr/bin/pkexec --user root ';
const STOCK_CHECK_CMD    = 'apt update';
const STOCK_UPDATE_CMD   = 'apt upgrade -y';
let CHECK_CMD          = PREPEND_CMD + STOCK_CHECK_CMD;
let UPDATE_CMD         = PREPEND_CMD + STOCK_UPDATE_CMD;

/* Variables we want to keep when extension is disabled (eg during screen lock) */
let UPDATES_PENDING        = -1;
let UPDATES_LIST           = [];

/* Various packages statuses */
const SCRIPT_NAMES = ['upgradable', 'new', 'obsolete', 'residual'];
const PKG_STATUS = {
    UPGRADABLE: 0,
    NEW: 1,
    OBSOLETE: 2,
    RESIDUAL: 3
};

/* Date arrays */
const MONTHS = [_('Jan'), _('Feb'), _('Mar'), _('Apr'), _('May'), _('Jun'),
                _('Jul'), _('Aug'), _('Sep'), _('Oct'), _('Nov'), _('Dec')];
const DAYS   = [_('Sun'), _('Mon'), _('Tue'), _('Wed'),
                _('Thu'), _('Fri'), _('Sat')];

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
    _upgradeProcess_pid: null,

    _process_sourceId: [null, null, null, null],
    _process_stream: [null, null, null, null],
    _process_pid: [null, null, null, null],

    _updateList: [],
    _newPackagesList: [],
    _obsoletePackagesList: [],
    _residualPackagesList: [],


    _init: function() {
        this.parent(0.0, "AptUpdateIndicator");

        this.updateIcon = new St.Icon({icon_name: 'system-software-update', style_class: 'system-status-icon'});

        let box = new St.BoxLayout({ vertical: false, style_class: 'panel-status-menu-box' });
        this.label = new St.Label({ text: '',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER });

        box.add_child(this.updateIcon);
        box.add_child(this.label);
        this.actor.add_child(box);

        // Prepare the special menu : a submenu for updates list that will look like a regular menu item when disabled
        // Scrollability will also be taken care of by the popupmenu
        this.menuExpander = new PopupMenu.PopupSubMenuMenuItem('');
        this.updatesListMenuLabel = new St.Label();
        this.menuExpander.menu.box.add(this.updatesListMenuLabel);
        this.menuExpander.menu.box.style_class = 'apt-update-indicator-list';

        this.newPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('New in repository'));
        this.newPackagesListMenuLabel = new St.Label();
        this.newPackagesExpander.menu.box.add(this.newPackagesListMenuLabel);
        this.newPackagesExpander.menu.box.style_class = 'apt-update-indicator-list';

        this.obsoletePackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Local/Obsolete packages'));
        this.obsoletePackagesListMenuLabel = new St.Label();
        this.obsoletePackagesExpander.menu.box.add(this.obsoletePackagesListMenuLabel);
        this.obsoletePackagesExpander.menu.box.style_class = 'apt-update-indicator-list';

        this.residualPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Residual config files'));
        this.residualPackagesListMenuLabel = new St.Label();
        this.residualPackagesExpander.menu.box.add(this.residualPackagesListMenuLabel);
        this.residualPackagesExpander.menu.box.style_class = 'apt-update-indicator-list';

        // Other standard menu items
        let settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
        this.updateNowMenuItem = new PopupMenu.PopupMenuItem(_('Apply updates'));

        // A special "Checking" menu item with a stop button
        this.checkingMenuItem = new PopupMenu.PopupBaseMenuItem( {reactive:false} );
        let checkingLabel = new St.Label({ text: _('Checking')});
        let cancelButton = new St.Button({
            child: new St.Icon({ icon_name: 'stop' }),
            style_class: 'system-menu-action apt-update-indicator-menubutton',
            x_expand: true
        });
        cancelButton.set_x_align(Clutter.ActorAlign.END);
        this.checkingMenuItem.actor.add_actor( checkingLabel );
        this.checkingMenuItem.actor.add_actor( cancelButton  );

        // A little trick on "check now" menuitem to keep menu opened
        this.checkNowMenuItem = new PopupMenu.PopupMenuItem( _('Check now') );
        this.lastCheckMenuItem = new PopupMenu.PopupMenuItem( _('') );
        this.lastCheckMenuItem.actor.visible = false;
        this.lastCheckMenuItem.actor.reactive = false;

        // Assemble all menu items into the popup menu
        this.menu.addMenuItem(this.menuExpander);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.newPackagesExpander);
        this.menu.addMenuItem(this.obsoletePackagesExpander);
        this.menu.addMenuItem(this.residualPackagesExpander);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.updateNowMenuItem);
        this.menu.addMenuItem(this.checkingMenuItem);
        this.menu.addMenuItem(this.checkNowMenuItem);
        this.menu.addMenuItem(this.lastCheckMenuItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(settingsMenuItem);

        // Bind some events
        this.menu.connect('open-state-changed', Lang.bind(this, this._onMenuOpened));
        this.checkNowMenuItem.connect('activate', Lang.bind(this, this._checkUpdates));
        cancelButton.connect('clicked', Lang.bind(this, this._cancelCheck));
        settingsMenuItem.connect('activate', Lang.bind(this, this._openSettings));
        this.updateNowMenuItem.connect('activate', Lang.bind(this, this._updateNow));

        // Load settings
        this._settings = Utils.getSettings();
        this._settingsChangedId = this._settings.connect('changed', Lang.bind(this, this._applySettings));
        this._applySettings();
        this._showChecking(false);

        // Restore previous state
        this._updateList = UPDATES_LIST;
        this._updateStatus(UPDATES_PENDING);

        // The first run is initialization only: we only read the existing files
        this._initializing = true;
        this._otherPackages(false, PKG_STATUS.UPGRADABLE);
    },

    _openSettings: function () {
        Util.spawn([ "gnome-shell-extension-prefs", Me.uuid ]);
    },

    _applySettings: function() {
        // Parse the various commands
        if (this._settings.get_string('update-cmd') !== "")
            UPDATE_CMD = PREPEND_CMD + this._settings.get_string('update-cmd');
        else
            UPDATE_CMD = PREPEND_CMD + STOCK_UPDATE_CMD;

        if (this._settings.get_string('check-cmd') !== "")
            CHECK_CMD = PREPEND_CMD + this._settings.get_string('check-cmd');
        else
            CHECK_CMD = PREPEND_CMD + STOCK_CHECK_CMD;

        if (this._settings.get_boolean('allow-no-passwd'))
            CHECK_CMD = this._settings.get_string('check-cmd-no-passwd');

        // Remove the periodic check before adding a new one
        if (this._TimeoutId)
            GLib.source_remove(this._TimeoutId);

        let that = this;
        let CHECK_INTERVAL = this._settings.get_int('check-interval') * 60;
        if (CHECK_INTERVAL)
            this._TimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                                       CHECK_INTERVAL,
                                                       function() {
                                                           that._checkUpdates();
                                                           return true;
                                                       });

        // Finalize application of settings
        this._checkShowHide();
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
        this.parent();
    },

    /* Menu functions:
     *     _checkShowHide
     *     _onMenuOpened
     *     _checkAutoExpandList
     *     _showChecking
     *     _updateStatus
     *     _updatePackagesStatus
     *     _updateNewPackagesStatus
     *     _updateObsoletePackagesStatus
     *     _updateResidualPackagesStatus
     *     _updateMenuExpander
     */

    _lastCheck: function() {
        let date = this._settings.get_string('last-check-date');

        // If not just initalizing, update the date string to 'now'
        if (!this._initializing) {
            let now = new Date();
            date = DAYS[now.getDay()] + ' ' + MONTHS[now.getMonth()] + ' ' +
                   now.getDate() + ', ';

            // Let's add missing zeroes
            if (!now.getHours())
                date += '0';
            date += now.getHours() + ':';

            if (now.getMinutes() < 10)
                date += '0';
            date += now.getMinutes();

            // Update the stored value
            this._settings.set_string('last-check-date', date);
        }

        if (date != '') {
            this.lastCheckMenuItem.label.set_text(_('Last check: ') + date);
            this.lastCheckMenuItem.actor.visible = true;
        }
    },

    _checkShowHide: function() {
        if ( UPDATES_PENDING == -3 )
            // Do not apply visibility change while checking for updates
            return;

        if (!this._settings.get_boolean('always-visible') && UPDATES_PENDING < 1)
            this.actor.visible = false;
        else
            this.actor.visible = true;
        this.label.visible = this._settings.get_boolean('show-count');
    },

    _onMenuOpened: function() {
        // This event is fired when menu is shown or hidden
        // Only open the submenu if the menu is being opened and there is something to show
        this._checkAutoExpandList();
    },

    _checkAutoExpandList: function() {
        if (this.menu.isOpen && UPDATES_PENDING > 0 && UPDATES_PENDING <= this._settings.get_int('auto-expand-list')) {
            this.menuExpander.setSubmenuShown(true);
        } else {
            this.menuExpander.setSubmenuShown(false);
        }
    },

    _showChecking: function(isChecking) {
        if (isChecking == true) {
            this.updateIcon.set_icon_name('emblem-synchronizing');
            this.checkNowMenuItem.actor.visible = false;
            this.checkingMenuItem.actor.visible = true;
        } else {
            this.checkNowMenuItem.actor.visible = true;
            this.checkingMenuItem.actor.visible = false;
        }
    },

    _updateStatus: function(updatesCount) {
        updatesCount = typeof updatesCount === 'number' ? updatesCount : UPDATES_PENDING;
        if (updatesCount > 0) {
            this._cleanUpgradeList();
            // Updates pending
            this.updateIcon.set_icon_name('software-update-available');
            this._updateMenuExpander( true, Gettext.ngettext( "%d update pending", "%d updates pending", updatesCount ).format(updatesCount) );
            this.updatesListMenuLabel.set_text( this._updateList.join("\n") );
            this.label.set_text(updatesCount.toString());
            if (this._settings.get_boolean('notify')
                && UPDATES_PENDING < updatesCount) {
                if (this._settings.get_int('verbosity') > 0) {
                    let updateList = [];
                    if (this._settings.get_int('verbosity') > 1) {
                        updateList = this._updateList;
                    } else {
                        // Keep only packets that was not in the previous notification
                        updateList = this._updateList.filter(function(pkg) { return UPDATES_LIST.indexOf(pkg) < 0 });
                    }
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
            }
            // Store the new list
            UPDATES_LIST = this._updateList;
        } else {
            this.updatesListMenuLabel.set_text("");
            this.label.set_text('');
            if (updatesCount == -1) {
                // Unknown
                this.updateIcon.set_icon_name('dialog-warning');
                this._updateMenuExpander( false, '' );
            } else if (updatesCount == -2) {
                // Error
                this.updateIcon.set_icon_name('error');
                this._updateMenuExpander( false, _('Error') );
            } else {
                // Up to date
                this.updateIcon.set_icon_name('system-software-update');
                this._updateMenuExpander( false, _('Up to date :)') );
                UPDATES_LIST = []; // Reset stored list
            }
        }
        UPDATES_PENDING = updatesCount;
        this._checkAutoExpandList();
        this._checkShowHide();
    },

    _cleanUpgradeList: function() {
        // This removes the the first line which reads: 'Listing...'
        this._updateList.shift();

        if (this._settings.get_boolean('strip-versions') == true) {
            this._updateList = this._updateList.map(function(p) {
                // example: firefox/jessie 50.0-1 amd64 [upgradable from: 49.0-4]
                // chunks[0] is the package name
                // chunks[1] is the remaining part
                var chunks = p.split("/",2);
                return chunks[0];
            });
        } else {
            this._updateList = this._updateList.map(function(p) {
                var chunks = p.split("/",2);
                var version = chunks[1].split(" ",3)[1];
                return chunks[0] + "\t" + version;
            });
        }
    },

    _updatePackagesStatus: function(index) {
        if (index == PKG_STATUS.UPGRADABLE)
            this._updateStatus(this._updateList.length - 1);
        else if (index == PKG_STATUS.NEW)
            this._updateNewPackagesStatus();
        else if (index == PKG_STATUS.OBSOLETE)
            this._updateObsoletePackagesStatus();
        else if (index == PKG_STATUS.RESIDUAL)
            this._updateResidualPackagesStatus();
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

    _updateMenuExpander: function(enabled, label) {
        if (label == "") {
            // No text, hide the menuitem
            this.menuExpander.actor.visible = false;
        } else {
        // We make our expander look like a regular menu label if disabled
            this.menuExpander.actor.reactive = enabled;
            this.menuExpander._triangle.visible = enabled;
            this.menuExpander.label.set_text(label);
            this.menuExpander.actor.visible = true;
        }

        // 'Update now' visibility is linked so let's save a few lines and set it here
        this.updateNowMenuItem.actor.reactive = enabled;
    },

    /* Upgrade functions:
     *     _updateNow
     *     _updateNowEnd
     */

    _updateNow: function () {
        this.menu.close();
        if(this._upgradeProcess_sourceId) {
            // A check is running ! Maybe we should kill it and run another one ?
            return;
        }
        try {
            // Parse check command line
            let [parseok, argvp] = GLib.shell_parse_argv( UPDATE_CMD );
            if (!parseok) { throw 'Parse error' };
            let [res, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(null,
                                                                                argvp,
                                                                                null,
                                                                                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                                                null);

            // We will process the output at once when it's done
            this._upgradeProcess_sourceId = GLib.child_watch_add(0, pid, Lang.bind(this, this._updateNowEnd));
            this._upgradeProcess_pid = pid;
        } catch (err) {
            // TODO log err.message.toString() ?
        }
    },

    _updateNowEnd: function() {
        // Free resources
        if (this._upgradeProcess_sourceId)
            GLib.source_remove(this._upgradeProcess_sourceId);
        this._upgradeProcess_sourceId = null;
        this._upgradeProcess_pid = null;

        // Check if updates are available
        this._otherPackages(false, PKG_STATUS.UPGRADABLE);
    },

    /* Update functions:
     *     _checkUpdates
     *     _cancelCheck
     *     _checkUpdatesEnd
     */

    _checkUpdates: function() {
        this.menu.close();
        if(this._upgradeProcess_sourceId) {
            // A check is already running ! Maybe we should kill it and run another one ?
            return;
        }
        // Run asynchronously, to avoid  shell freeze - even for a 1s check
        this._showChecking(true);
        try {
            // Parse check command line
            let [parseok, argvp] = GLib.shell_parse_argv( CHECK_CMD );
            if (!parseok) { throw 'Parse error' };
            let [res, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(null,
                                                                                argvp,
                                                                                null,
                                                                                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                                                null);

            // We will process the output at once when it's done
            this._upgradeProcess_sourceId = GLib.child_watch_add(0, pid, Lang.bind(this, this._checkUpdatesEnd));
            this._upgradeProcess_pid = pid;
        } catch (err) {
            this._showChecking(false);
            // TODO log err.message.toString() ?
            this._updateStatus(-2);
        }
    },

    _cancelCheck: function() {
        if (this._upgradeProcess_pid == null) { return; };
        Util.spawnCommandLine( "kill " + this._upgradeProcess_pid );
        this._upgradeProcess_pid = null; // Prevent double kill
        this._checkUpdatesEnd();
    },

    _checkUpdatesEnd: function() {
        // Free resources
        if (this._upgradeProcess_sourceId)
            GLib.source_remove(this._upgradeProcess_sourceId);
        this._upgradeProcess_sourceId = null;
        this._upgradeProcess_pid = null;

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
            let script = [];
            let path = null;
            if (index == PKG_STATUS.UPGRADABLE)
                script = ['/usr/bin/apt', 'list', '--upgradable'];
            else {
                path = Me.dir.get_path();
                script = [path + '/' + SCRIPT_NAMES[index] + '.sh',
                          initializing ? '1' : '0'];
            }

            let [res, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(path,
                                                                                script,
                                                                                null,
                                                                                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                                                                null);

            // Let's buffer the command's output - that's a input for us !
            this._process_stream[index] = new Gio.DataInputStream({
                base_stream: new Gio.UnixInputStream({fd: out_fd})
            });

            // We will process the output at once when it's done
            this._process_pid[index] = pid;
            this._process_sourceId[index] = GLib.child_watch_add(0, pid, Lang.bind(this,
                function() {
                    this._packagesRead(index);
                    return true;
                }));
        } catch (err) {
            if (index == PKG_STATUS.UPGRADABLE) {
                this._showChecking(false);
                // TODO log err.message.toString() ?
                this._updateStatus(-2);
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

        this._packagesEnd(index);
    },

    _packagesEnd: function(index) {
        // Free resources
        this._process_stream  [index].close(null);
        this._process_stream  [index] = null;
        if (this._process_sourceId[index])
            GLib.source_remove(this._process_sourceId[index]);
        this._process_sourceId[index] = null;
        this._process_pid     [index] = null;

        // Update indicator
        this._updatePackagesStatus(index);

        if (index == PKG_STATUS.UPGRADABLE) {
            // Update indicator
            this._showChecking(false);

            // Update time on menu
            this._lastCheck();

            // Launch other checks
            this._otherPackages(this._initializing, PKG_STATUS.NEW);
            this._otherPackages(this._initializing, PKG_STATUS.OBSOLETE);
            this._otherPackages(this._initializing, PKG_STATUS.RESIDUAL);
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
                return new St.Icon({ icon_name: 'system-software-update' });
            };
            // Take care of note leaving unneeded sources
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
