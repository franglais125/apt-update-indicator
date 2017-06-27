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
    Copyright 2017 Fran Glais
*/

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;

const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;

const Util = imports.misc.util;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const Gettext = imports.gettext.domain('apt-update-indicator');
const _ = Gettext.gettext;

/* For error checking */
const STATUS = {
    UNKNOWN:      -1,
    ERROR:        -2,
    NO_INTERNET:  -3,
    INITIALIZING: -4
};

/* Variables we want to keep when extension is disabled (eg during screen lock) */
let UPDATES_PENDING = STATUS.UNKNOWN;
let UPDATES_LIST    = [];

/* Various packages statuses */
const SCRIPT = {
    UPGRADES:      0,
    NEW:           1,
    OBSOLETE:      2,
    RESIDUAL:      3,
    AUTOREMOVABLE: 4
};
const AptUpdateIndicator = new Lang.Class({
    Name: 'AptUpdateIndicator',
    Extends: PanelMenu.Button,

    _TimeoutId: null,

    _upgradeProcess_sourceId: null,
    _upgradeProcess_stream: null,

    _process_sourceId: [null, null, null, null],
    _process_stream: [null, null, null, null],

    _updateList: [],
    _urgentList: [],
    _newPackagesList: [],
    _obsoletePackagesList: [],
    _residualPackagesList: [],
    _autoremovablePackagesList: [],

    _init: function(updateManager) {

        this._updateManager = updateManager;

        let alignment = 0.0;
        let buttonName = 'AptUpdateIndicator';
        let dontCreateMenu = false;
        this.parent(alignment, buttonName, dontCreateMenu);

        Gtk.IconTheme.get_default().append_search_path(Me.dir.get_child('media').get_path());

        this.updateIcon = new St.Icon({icon_name: 'apt-update-indicator-symbolic', style_class: 'system-status-icon'});

        this.box = new St.BoxLayout({ vertical: false, style_class: 'panel-status-menu-box' });
        this.label = new St.Label({ text: '',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER });
        this.label.visible = false;

        this.box.add_child(this.updateIcon);
        this.box.add_child(this.label);
        this.actor.add_child(this.box);

        // Prepare to track connections
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        // Assemble the menu
        this._assembleMenu();

        // Load settings
        this._settings = Utils.getSettings();
        this._bindSignals();

        Main.panel.addToStatusArea('AptUpdateIndicator', this);
    },

    _openSettings: function () {
        Util.spawn([ 'gnome-shell-extension-prefs', Me.uuid ]);
    },

    _bindSignals: function() {
        // Bind settings
        this._signalsHandler.add([
            this._settings,
            'changed::show-count',
            Lang.bind(this, this._checkShowHideIndicator)
        ],[
            this._settings,
            'changed::always-visible',
            Lang.bind(this, this._checkShowHideIndicator)
        ],[
        // Bind some events
            this.menu,
            'open-state-changed',
            Lang.bind(this, this._onMenuOpened)
        ],[
            this.settingsMenuItem,
            'activate',
            Lang.bind(this, this._openSettings)
        ]);
    },

    _assembleMenu: function() {
        // Prepare the special menu : a submenu for updates list that will look like a regular menu item when disabled
        // Scrollability will also be taken care of by the popupmenu
        this.updatesExpander = new PopupMenu.PopupSubMenuMenuItem('');
        this.updatesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.urgentListMenuLabel = null;
        this.updatesListMenuLabel = null;

        this.newPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('New in repository'));
        this.newPackagesListMenuLabel = new St.Label({style_class: 'apt-update-indicator-updatelabel'});
        this.newPackagesExpander.menu.box.add(this.newPackagesListMenuLabel);
        this.newPackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.newPackagesExpander.actor.visible = false;

        this.obsoletePackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Local/Obsolete packages'));
        this.obsoletePackagesListMenuLabel = new St.Label({style_class: 'apt-update-indicator-updatelabel'});
        this.obsoletePackagesExpander.menu.box.add(this.obsoletePackagesListMenuLabel);
        this.obsoletePackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.obsoletePackagesExpander.actor.visible = false;

        this.residualPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Residual config files'));
        this.residualPackagesListMenuLabel = new St.Label({style_class: 'apt-update-indicator-updatelabel'});
        this.residualPackagesExpander.menu.box.add(this.residualPackagesListMenuLabel);
        this.residualPackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.residualPackagesExpander.actor.visible = false;

        this.autoremovablePackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Autoremovable'));
        this.autoremovablePackagesListMenuLabel = new St.Label({style_class: 'apt-update-indicator-updatelabel'});
        this.autoremovablePackagesExpander.menu.box.add(this.autoremovablePackagesListMenuLabel);
        this.autoremovablePackagesExpander.menu.box.style_class = 'apt-update-indicator-list';
        this.autoremovablePackagesExpander.actor.visible = false;

        // Other standard menu items
        this.settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
        this.applyUpdatesMenuItem = new PopupMenu.PopupMenuItem(_('Apply updates'));

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
        this.menu.addMenuItem(this.applyUpdatesMenuItem);
        this.menu.addMenuItem(this.checkNowMenuItem);
        this.menu.addMenuItem(this.lastCheckMenuItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.settingsMenuItem);
    },

    destroy: function() {
        // Disconnect global signals
        this._signalsHandler.destroy();

        this.box.destroy();
        this.label.destroy();

        this.parent();
    },

    /* Menu functions:
     *     _checkShowHideIndicator
     *     _onMenuOpened
     *     _checkAutoExpandList
     *     showChecking
     *     updateStatus
     *     updatePackagesStatus
     *     _updateNewPackagesStatus
     *     _updateObsoletePackagesStatus
     *     _updateResidualPackagesStatus
     *     _updateAutoremovablePackagesStatus
     *     _updateMenuExpander
     */

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

    showChecking: function(isChecking) {
        if (isChecking == true) {
            this.updateIcon.set_icon_name('emblem-synchronizing-symbolic');
            this.checkNowMenuItem.actor.reactive = false;
            this.checkNowMenuItem.label.set_text(_('Checking'));
        } else {
            this.checkNowMenuItem.actor.reactive = true;
            this.checkNowMenuItem.label.set_text(_('Check now'));
        }
    },

    updateStatus: function(updatesCount) {
        updatesCount = typeof updatesCount === 'number' ? updatesCount : this._updateList.length;
        if (updatesCount > 0) {
            // Destroy existing labels to ensure correct display
            if (this.urgentListMenuLabel) {
                this.urgentListMenuLabel.destroy();
                this.urgentListMenuLabel = null;
            }
            if (this.updatesListMenuLabel) {
                this.updatesListMenuLabel.destroy();
                this.updatesListMenuLabel = null;
            }

            // Update the menu look:
            this._cleanUpgradeLists();

            let icon_name = 'software-update-available-symbolic';
            let menuUpdateList = this._updateList;

            if (this._urgentList.length > 0) {
                // Update icon name and updates list
                icon_name = 'software-update-urgent-symbolic';
                menuUpdateList = this._updateList.filter(Lang.bind(this,
                    function(pkg) { return this._urgentList.indexOf(pkg) < 0; }
                ));

                this.urgentListMenuLabel = new St.Label({style_class: 'apt-update-indicator-urgentlabel'});
                this.updatesExpander.menu.box.add(this.urgentListMenuLabel);

                // If there are non-security updates, add an extra line
                this.urgentListMenuLabel.set_text(
                    'Important/Security\n\n' +
                    this._urgentList.join(' \n')
                );
            }

            // Update indicator look:
            this.updateIcon.set_icon_name(icon_name);
            this.label.set_text(updatesCount.toString());

            if (menuUpdateList.length > 0) {

                this.updatesListMenuLabel = new St.Label({style_class: 'apt-update-indicator-updatelabel'});
                this.updatesExpander.menu.box.add(this.updatesListMenuLabel);

                let subTitle = '';
                if (this._urgentList.length > 0) {
                    subTitle = '\nRegular\n\n';
                }
                this.updatesListMenuLabel.set_text( subTitle + menuUpdateList.join(' \n') );
            }

            this._updateMenuExpander( true, Gettext.ngettext( '%d update pending',
                                                              '%d updates pending',
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
            if (this.updatesListMenuLabel) {
                this.updatesListMenuLabel.destroy();
                this.updatesListMenuLabel = null;
            }
            if (this.urgentListMenuLabel) {
                this.urgentListMenuLabel.destroy();
                this.urgentListMenuLabel = null;
            }

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
            } else if (updatesCount == STATUS.INITIALIZING) {
                this.updateIcon.set_icon_name('apt-update-indicator-symbolic');
                this._updateMenuExpander( false, _('Initializing') );
            } else {
                // Up to date
                this.updateIcon.set_icon_name('apt-update-indicator-symbolic');
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
                updateList = this._updateList.filter(function(pkg) { return UPDATES_LIST.indexOf(pkg) < 0; });
            }

            // Replace tab(s) with one space
            updateList = this._updateList.map(function(p) {
                p = p.replace('\t', ' ');
                return p.replace(/\s\s+/g, ' '); // Removes double saces (\s)
            });

            if (updateList.length > 50)
                // We show a maximum of 50 updates on the notification, as it can
                // freeze the shell if the text is too long
                updateList = updateList.slice(0, 50);

            if (updateList.length > 0) {
                // Show notification only if there's new updates
                this._showNotification(
                    Gettext.ngettext( 'New Update', 'New Updates', updateList.length ),
                    updateList.join(', ')
                );
            }

        } else {
            this._showNotification(
                Gettext.ngettext( 'New Update', 'New Updates', updatesCount ),
                Gettext.ngettext( 'There is %d update pending', 'There are %d updates pending', updatesCount ).format(updatesCount)
            );
        }
    },

    _cleanUpgradeLists: function() {
        // We first find the longest entry in both lists
        let maxWidth = 0;
        this._updateList.forEach(function(line) {
            // example: firefox [tab] 50.0-1
            var name = line.split('\t',2)[0];
            maxWidth = name.length > maxWidth ? name.length : maxWidth;
        });
        this._urgentList.forEach(function(line) {
            // example: firefox [tab] 50.0-1
            var name = line.split('\t',2)[0];
            maxWidth = name.length > maxWidth ? name.length : maxWidth;
        });
        this._updateList = this._cleanUpgradeList(this._updateList, maxWidth);
        this._urgentList = this._cleanUpgradeList(this._urgentList, maxWidth);
    },

    _cleanUpgradeList: function(list, maxWidth) {
        if (this._settings.get_boolean('strip-versions') == true) {
            return list.map(function(p) {
                // example: firefox 50.0-1
                // chunks[0] is the package name
                // chunks[1] is the version
                var chunks = p.split('\t',2);
                return chunks[0];
            });
        } else {
            let tabWidth = 8;
            let widthNeeded = tabWidth*(Math.floor(maxWidth / tabWidth) + 1) - 1;
            return list.map(function(p) {
                var chunks = p.split('\t',2);
                let difference = widthNeeded - chunks[0].length;
                let nTabs = Math.floor(difference / tabWidth);
                let spacing = '\t';
                for (let i = 0; i < nTabs; i++)
                    spacing += '\t';
                return chunks[0] + spacing + chunks[1];
            });
        }
    },

    updatePackagesStatus: function(index) {
        switch (index) {
            case SCRIPT.UPGRADES:
                this.updateStatus(this._updateList.length);
                break;
            case SCRIPT.NEW:
                this._updateNewPackagesStatus();
                break;
            case SCRIPT.OBSOLETE:
                this._updateObsoletePackagesStatus();
                break;
            case SCRIPT.RESIDUAL:
                this._updateResidualPackagesStatus();
                break;
            case SCRIPT.AUTOREMOVABLE:
                this._updateAutoremovablePackagesStatus();
                break;
        }
    },

    _updateNewPackagesStatus: function() {
        if (this._newPackagesList.length == 0) {
            this.newPackagesExpander.actor.visible = false;
        } else {
            this.newPackagesListMenuLabel.set_text( this._newPackagesList.join('\n') );
            this.newPackagesExpander.actor.visible = true;
        }
    },

    _updateObsoletePackagesStatus: function() {
        if (this._obsoletePackagesList.length == 0)
            this.obsoletePackagesExpander.actor.visible = false;
        else {
            this.obsoletePackagesListMenuLabel.set_text( this._obsoletePackagesList.join('\n') );
            this.obsoletePackagesExpander.actor.visible = true;
        }
    },

    _updateResidualPackagesStatus: function() {
        if (this._residualPackagesList.length == 0)
            this.residualPackagesExpander.actor.visible = false;
        else {
            this.residualPackagesListMenuLabel.set_text( this._residualPackagesList.join('\n') );
            this.residualPackagesExpander.actor.visible = true;
        }
    },

    _updateAutoremovablePackagesStatus: function() {
        if (this._autoremovablePackagesList.length == 0)
            this.autoremovablePackagesExpander.actor.visible = false;
        else {
            this.autoremovablePackagesListMenuLabel.set_text( this._autoremovablePackagesList.join('\n') );
            this.autoremovablePackagesExpander.actor.visible = true;
        }
    },

    _updateMenuExpander: function(enabled, label) {
        if (label == '') {
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
        this.applyUpdatesMenuItem.actor.reactive = enabled;
    },

    /*
     * Notifications
     * */

    _showNotification: function(title, message) {
        if (this._notifSource == null) {
            // We have to prepare this only once
            this._notifSource = new MessageTray.SystemNotificationSource();
            this._notifSource.createIcon = function() {
                return new St.Icon({ icon_name: 'apt-update-indicator-symbolic' });
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
            notification.addAction( _('Update now') , Lang.bind(this, function() {this._updateManager._applyUpdates()}) );
        } else {
            notification = this._notifSource.notifications[0];
            notification.update( title, message, { clear: true });
        }
        notification.setTransient(this._settings.get_boolean('transient'));
        this._notifSource.notify(notification);
    },


});

