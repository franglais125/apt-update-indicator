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

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Gettext = imports.gettext.domain('apt-update-indicator');
const _ = Gettext.gettext;


const NetworkMonitor = new Lang.Class({
    Name: 'NetworkMonitor',

    _init: function() {
        // We check for the network status before trying to update apt-cache
        this._network_monitor = Gio.network_monitor_get_default();
        this._connectionId = this._network_monitor.connect('network-changed',
                                                           Lang.bind(this, this._checkConnectionState));
        this._checkConnectionState();
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
        if (this._connectionId) {
            this._network_monitor.disconnect(this._connectionId);
            this._connectionId = null;
        }
    }
});

const DirectoryMonitor = new Lang.Class({
    Name: 'DirectoryMonitor',

    _init: function(indicator) {
        this._indicator = indicator;

        this.start();
    },

    start: function() {
        global.log('starting dir monitor!');
        this.stop();

        let directory = '/var/lib/apt/lists';
        this._apt_dir = Gio.file_new_for_path(directory);
        this._apt_monitor = this._apt_dir.monitor_directory(0, null, null);
        this._apt_monitorId = this._apt_monitor.connect('changed',
                                                      Lang.bind(this, this._onFolderChanged));

        directory = '/var/lib/dpkg';
        this._dpkg_dir = Gio.file_new_for_path(directory);
        this._dpkg_monitor = this._dpkg_dir.monitor_directory(0, null, null);
        this._dpkg_monitorId = this._dpkg_monitor.connect('changed',
                                                        Lang.bind(this, this._onFolderChanged));
    },

    stop: function() {
        if (this._apt_monitorId) {
            this._apt_monitor.disconnect(this._apt_monitorId);
            this._apt_monitorId = null;
        }

        if (this._dpkg_monitorId) {
            this._dpkg_monitor.disconnect(this._dpkg_monitorId);
            this._dpkg_monitorId = null;
        }

        if (this._folderMonitorId) {
            GLib.source_remove(this._folderMonitorId);
            this._folderMonitorId = null;
        }
    },

    _onFolderChanged: function() {
        // Apt cache has changed! Let's schedule a check in a few seconds
        if (this._folderMonitorId)
            GLib.source_remove(this._folderMonitorId);
        let timeout = 10;
        this._folderMonitorId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                                        timeout,
                                                        Lang.bind(this, function () {
                                                            global.log('  updating from onFolderChanged');
                                                            let initializing = false;
                                                            let checkUpgrades = 0;
                                                            this._indicator._otherPackages(initializing, checkUpgrades);
                                                            this._folderMonitorId = null;
                                                            return false;
                                                        }));
    },

    destroy: function() {
        this.stop();
    }
});
