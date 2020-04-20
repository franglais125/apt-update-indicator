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
    Copyright 2017-2020 Fran Glais
*/

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const St = imports.gi.St;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

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

const Clipboard = St.Clipboard.get_default();

/* For error checking */
var STATUS = {
    UNKNOWN:      -1,
    ERROR:        -2,
    NO_INTERNET:  -3,
    INITIALIZING: -4
};

/* Variables we want to keep when extension is disabled (eg during screen lock) */
let UPDATES_PENDING = STATUS.UNKNOWN;
let UPDATES_LIST    = [];

/* Various packages statuses */
var SCRIPT = {
    UPGRADES:      0,
    NEW:           1,
    OBSOLETE:      2,
    RESIDUAL:      3,
    AUTOREMOVABLE: 4
};

var AptUpdateIndicator = GObject.registerClass(class AptUpdateIndicator extends PanelMenu.Button {
    _init(updateManager) {

        this._TimeoutId = null;

        this._upgradeProcess_sourceId = null;
        this._upgradeProcess_stream = null;

        this._process_sourceId = [null, null, null, null];
        this._process_stream =   [null, null, null, null];

        this._updateList = [];
        this._urgentList = [];
        this._newPackagesList = [];
        this._obsoletePackagesList = [];
        this._residualPackagesList = [];
        this._autoremovablePackagesList = [];

        this._updateManager = updateManager;

        let alignment = 0.0;
        let buttonName = 'AptUpdateIndicator';
        let dontCreateMenu = false;
        super._init(alignment, buttonName, dontCreateMenu);

        this.updateIcon = new St.Icon({icon_name: 'package-x-generic-symbolic', style_class: 'system-status-icon'});

        this.box = new St.BoxLayout({ vertical: false, style_class: 'panel-status-menu-box' });
        this.label = new St.Label({ text: '',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER });
        this.label.visible = false;

        this.box.add_child(this.updateIcon);
        this.box.add_child(this.label);
        this.add_child(this.box);

        // Prepare to track connections
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        // Assemble the menu
        this._assembleMenu();

        // Load settings
        this._settings = Utils.getSettings();
        this._bindSignals();

        Main.panel.addToStatusArea('AptUpdateIndicator', this);

        this._shortcutIsSet = false;
        this._toggleShortcut();
    }

    _openSettings() {
        Util.spawn([ 'gnome-shell-extension-prefs', Me.uuid ]);
    }

    _bindSignals() {
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
            this._settings,
            'changed::use-shortcut',
            Lang.bind(this, this._toggleShortcut)
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
    }

    _assembleMenu() {
        // Prepare the special menu : a submenu for updates list that will look like a regular menu item when disabled
        // Scrollability will also be taken care of by the popupmenu
        this.updatesExpander = new PopupMenu.PopupSubMenuMenuItem('');

        this.newPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('New in repository'));
        this.newPackagesExpander.visible = false;

        this.obsoletePackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Local/Obsolete packages'));
        this.obsoletePackagesExpander.visible = false;

        this.residualPackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Residual config files'));
        this.residualPackagesExpander.visible = false;

        this.autoremovablePackagesExpander = new PopupMenu.PopupSubMenuMenuItem(_('Autoremovable'));
        this.autoremovablePackagesExpander.visible = false;

        // Other standard menu items
        this.settingsMenuItem = new PopupMenu.PopupMenuItem(_('Settings'));
        this.applyUpdatesMenuItem = new PopupMenu.PopupMenuItem(_('Apply updates'));

        // "Check now" and "Last Check" menu items
        this.checkNowMenuItem = new PopupMenu.PopupMenuItem( _('Check now') );
        this.lastCheckMenuItem = new PopupMenu.PopupMenuItem( '' );
        this.lastCheckMenuItem.reactive = false;
        this.lastCheckMenuItem.visible = false;

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
    }

    destroy() {
        // Disconnect global signals
        this._signalsHandler.destroy();

        this.box.destroy();

        this._disableShortcut();

        this.parent();
    }

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

    _checkShowHideIndicator() {
        if ( this._upgradeProcess_sourceId )
            // Do not apply visibility change while checking for updates
            return;

        if (!this._settings.get_boolean('always-visible') && this._updateList.length < 1)
            this.visible = false;
        else
            this.visible = true;

        this.label.visible = this._settings.get_boolean('show-count') &&
                             this._updateList.length > 0;
    }

    _onMenuOpened() {
        // This event is fired when menu is shown or hidden
        // Only open the submenu if the menu is being opened and there is something to show
        this._checkAutoExpandList();
    }

    _checkAutoExpandList() {
        let count = this._updateList.length;
        if (this.menu.isOpen &&
            count > 0 &&
            count <= this._settings.get_int('auto-expand-list')) {
            this.updatesExpander.setSubmenuShown(true);
        } else {
            this.updatesExpander.setSubmenuShown(false);
        }
    }

    showChecking(isChecking) {
        if (isChecking == true) {
            this.updateIcon.set_icon_name('emblem-synchronizing-symbolic');
            this.checkNowMenuItem.reactive = false;
            this.checkNowMenuItem.label.set_text(_('Checking'));
        } else {
            this.checkNowMenuItem.reactive = true;
            this.checkNowMenuItem.label.set_text(_('Check now'));
        }
    }

    updateStatus(updatesCount) {
        updatesCount = typeof updatesCount === 'number' ? updatesCount : this._updateList.length;
        if (updatesCount > 0) {
            // Destroy existing labels to ensure correct display
            this.updatesExpander.menu.removeAll();

            // Update the menu look:
            this._cleanUpgradeLists();

            let icon_name = this._urgentList.length > 0 ?
                'software-update-urgent-symbolic' :
                'software-update-available-symbolic';
            let menuUpdateList = this._urgentList.length > 0 ?
                this._updateList.filter(Lang.bind(this,
                    function(pkg) { return this._urgentList.indexOf(pkg) < 0; }
                )) :
                this._updateList;

            if (this._urgentList.length > 0) {
                let header = new PopupMenu.PopupMenuItem('Important/Security')
                header.add_style_class_name('apt-update-indicator-urgent-item-header');
                this.updatesExpander.menu.addMenuItem(header);

                for (let i = 0; i < this._urgentList.length; i++) {
                    let text = this._urgentList[i];
                    let item = this._createItem(text);
                    item.remove_style_class_name('apt-update-indicator-item');
                    item.add_style_class_name('apt-update-indicator-urgent-item');
                    this.updatesExpander.menu.addMenuItem(item);
                }
            }

            // Update indicator look:
            this.updateIcon.set_icon_name(icon_name);
            this.label.set_text(updatesCount.toString());

            if (menuUpdateList.length > 0) {
                // If there are urgent updates we need to add a section title
                if (this._urgentList.length > 0) {
                    let separator = new PopupMenu.PopupSeparatorMenuItem();
                    separator.add_style_class_name('apt-update-indicator-separator');
                    this.updatesExpander.menu.addMenuItem(separator);

                    let updatesListMenuLabel = new PopupMenu.PopupMenuItem('');
                    updatesListMenuLabel.add_style_class_name('apt-update-indicator-item-header');
                    updatesListMenuLabel.label.set_text('Regular');
                    this.updatesExpander.menu.addMenuItem(updatesListMenuLabel);
                }

                for (let i = 0; i < menuUpdateList.length; i++) {
                    let text = menuUpdateList[i];
                    let item = this._createItem(text);
                    this.updatesExpander.menu.addMenuItem(item);
                }
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
                this.updateIcon.set_icon_name('package-x-generic-symbolic');
                this._updateMenuExpander( false, _('Initializing') );
            } else {
                // Up to date
                this.updateIcon.set_icon_name('package-x-generic-symbolic');
                this._updateMenuExpander( false, _('Up to date') );
                UPDATES_LIST = []; // Reset stored list
            }
        }

        UPDATES_PENDING = updatesCount;
        this._checkAutoExpandList();
        this._checkShowHideIndicator();
    }

    _notify(updatesCount) {
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
                return p.replace(/\s\s+/g, ' '); // Removes double spaces (\s)
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
    }

    _cleanUpgradeLists() {
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
    }

    _cleanUpgradeList(list, maxWidth) {
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
    }

    updatePackagesStatus(index) {
        switch (index) {
            case SCRIPT.UPGRADES:
                Mainloop.idle_add(
                    Lang.bind(this,
                        function() {
                            this.updateStatus(this._updateList.length);
                        })
                );
                break;
            case SCRIPT.NEW:
                Mainloop.idle_add(
                    Lang.bind(this, this._updateNewPackagesStatus)
                );
                break;
            case SCRIPT.OBSOLETE:
                Mainloop.idle_add(
                    Lang.bind(this, this._updateObsoletePackagesStatus)
                );
                break;
            case SCRIPT.RESIDUAL:
                Mainloop.idle_add(
                    Lang.bind(this, this._updateResidualPackagesStatus)
                );
                break;
            case SCRIPT.AUTOREMOVABLE:
                Mainloop.idle_add(
                    Lang.bind(this, this._updateAutoremovablePackagesStatus)
                );
                break;
        }
    }

    _updateNewPackagesStatus() {
        this.newPackagesExpander.menu.removeAll();
        if (this._newPackagesList.length == 0)
            this.newPackagesExpander.visible = false;
        else {
            for (let i = 0; i < this._newPackagesList.length; i++) {
                let text = this._newPackagesList[i];
                let item = this._createItem(text);
                this.newPackagesExpander.menu.addMenuItem(item);
            }
            this.newPackagesExpander.visible = true;
        }
    }

    _updateObsoletePackagesStatus() {
        this.obsoletePackagesExpander.menu.removeAll();
        if (this._obsoletePackagesList.length == 0)
            this.obsoletePackagesExpander.visible = false;
        else {
            for (let i = 0; i < this._obsoletePackagesList.length; i++) {
                let text = this._obsoletePackagesList[i];
                let item = this._createItem(text);
                this.obsoletePackagesExpander.menu.addMenuItem(item);
            }
            this.obsoletePackagesExpander.visible = true;
        }
    }

    _updateResidualPackagesStatus() {
        this.residualPackagesExpander.menu.removeAll();
        if (this._residualPackagesList.length == 0)
            this.residualPackagesExpander.visible = false;
        else {
            for (let i = 0; i < this._residualPackagesList.length; i++) {
                let text = this._residualPackagesList[i];
                let item = this._createItem(text);
                this.residualPackagesExpander.menu.addMenuItem(item);
            }
            this.residualPackagesExpander.visible = true;
        }
    }

    _updateAutoremovablePackagesStatus() {
        this.autoremovablePackagesExpander.menu.removeAll();
        if (this._autoremovablePackagesList.length == 0)
            this.autoremovablePackagesExpander.visible = false;
        else {
            for (let i = 0; i < this._autoremovablePackagesList.length; i++) {
                let text = this._autoremovablePackagesList[i];
                let item = this._createItem(text);
                this.autoremovablePackagesExpander.menu.addMenuItem(item);
            }
            this.autoremovablePackagesExpander.visible = true;
        }
    }

    _createItem(text) {
        let item = new PopupMenu.PopupMenuItem('');
        item.add_style_class_name('apt-update-indicator-item');
        item.label.set_text(text);

        // Remove tab character and then double spaces
        text = text.replace('\t', ' ');
        text = text.replace(/\s\s+/g, ' ');
        item.connect('activate', function() {
            Clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            Clipboard.set_text(St.ClipboardType.PRIMARY, text);
        });

        return item;
    }

    _updateMenuExpander(enabled, label) {
        if (label == '') {
            // No text, hide the menuitem
            this.updatesExpander.visible = false;
        } else {
        // We make our expander look like a regular menu label if disabled
            this.updatesExpander.reactive = enabled;
            this.updatesExpander._triangle.visible = enabled;
            this.updatesExpander.label.set_text(label);
            this.updatesExpander.visible = true;
        }

        // 'Update now' visibility is linked so let's save a few lines and set it here
        this.applyUpdatesMenuItem.reactive = enabled;
    }

    /*
     * Notifications
     * */

    _showNotification(title, message) {
        if (this._notifSource == null) {
            // We have to prepare this only once
            this._notifSource = new MessageTray.SystemNotificationSource();
            this._notifSource.createIcon = function() {
                return new St.Icon({ icon_name: 'package-x-generic-symbolic' });
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
        this._notifSource.showNotification(notification);
    }

    _toggleShortcut() {
        if (this._settings.get_boolean('use-shortcut'))
            this._enableShortcut();
        else
            this._disableShortcut();
    }

    _enableShortcut() {
        if (!this._shortcutIsSet) {
            Main.wm.addKeybinding('apt-update-indicator-shortcut', this._settings,
                                  Meta.KeyBindingFlags.NONE,
                                  Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                                  Lang.bind(this.menu, this.menu.toggle));
            this._shortcutIsSet = true;
        }
    }

    _disableShortcut() {
        if (this._shortcutIsSet) {
            Main.wm.removeKeybinding('apt-update-indicator-shortcut');
            this._shortcutIsSet = false;
        }
    }

});

