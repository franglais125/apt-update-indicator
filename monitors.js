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
        // When initializing, we wait a bit before the first network check
        this._initializing = true;
        this.connected = false;

        // We check for the network status before trying to update apt-cache
        this._network_monitor = Gio.network_monitor_get_default();

        // On network changes, wait 3 seconds before pinging.
        // This avoids repeatedly sending async requests and flooding the logs.
        this._networkTimeoutId = 0;
        this._connectionId = this._network_monitor.connect('network-changed',
                                                           Lang.bind(this, this._networkTimeout));
        this._networkTimeout();
    },

    _networkTimeout: function() {
        if (this._networkTimeoutId) {
            GLib.source_remove(this._networkTimeoutId);
            this._networkTimeoutId = 0;
        }

        // Block checks for updates while we ensure the connection is up
        this.connected = false;

        // Timeout in milliseconds. Just over a second, as there seems to be a 1s
        // timeout elsewhere in the Shell: 'network-changed' is suspiciously
        // emitted at 1s intervals very often.
        let timeout = 1250;
        if (this._initializing) {
            timeout = 3000;
            this._initializing = false;
        }
        this._networkTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            timeout,
            Lang.bind(this, function() {
                this._checkConnectionState();
                this._networkTimeoutId = 0;
                return false;
            })
        );
    },

    _checkConnectionState: function() {
        let url = 'http://ftp.debian.org';
        let address = Gio.NetworkAddress.parse_uri(url, 80);
        let cancellable = Gio.Cancellable.new();
        this.connected = false;
        try {
            this._network_monitor.can_reach_async(address, cancellable, Lang.bind(this, this._asyncReadyCallback));
        } catch (err) {
            let title = _('Can not connect to %s').format(url);
            log(title + '\n' + err.message);
        }
    },

    _asyncReadyCallback: function(nm, res) {
        this.connected = this._network_monitor.can_reach_finish(res);
    },

    destroy: function() {
        if (this._connectionId) {
            this._network_monitor.disconnect(this._connectionId);
            this._connectionId = null;
        }

        if (this._networkTimeoutId) {
            GLib.source_remove(this._networkTimeoutId);
            this._networkTimeoutId = 0;
        }
    }
});

const DirectoryMonitor = new Lang.Class({
    Name: 'DirectoryMonitor',

    _init: function(updateManager) {
        this._updateManager = updateManager;

        this.start();
    },

    start: function() {
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
                                                            let checkUpgrades = 0;
                                                            this._updateManager._dontUpdateDate = true;
                                                            this._updateManager._launchScript(checkUpgrades);
                                                            this._folderMonitorId = null;
                                                            return false;
                                                        }));
    },

    destroy: function() {
        this.stop();
    }
});
