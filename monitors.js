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
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;

const Gettext = imports.gettext.domain('apt-update-indicator');
const _ = Gettext.gettext;

var NetworkMonitor = class NetworkMonitor {
    constructor(updateManager) {

        this._updateManager = updateManager;

        // We check for the network status before trying to update apt-cache
        this._network_monitor = Gio.network_monitor_get_default();

        this._networkTimeoutId = 0;

        let url = 'http://ftp.debian.org';
        this._address = Gio.NetworkAddress.parse_uri(url, 80);
    }

    networkTimeout() {
        if (this._networkTimeoutId) {
            GLib.source_remove(this._networkTimeoutId);
            this._networkTimeoutId = 0;
        }

        // Timeout in seconds. We allow 10 seconds for the network check to
        // finish. If it doesn't, we assume the network is down.
        let timeout = 10;
        this._networkTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            timeout,
            () => {
                this._updateManager.networkFailed();
                this._networkTimeoutId = 0;
                return false;
            }
        );

        this._checkConnectionState();
    }

    _checkConnectionState() {
        let cancellable = Gio.Cancellable.new();
        try {
            this._network_monitor.can_reach_async(this._address, cancellable, this._asyncReadyCallback.bind(this));
        } catch (err) {
            let title = _('Can not connect to %s').format(url);
            log(title + '\n' + err.message);
        }
    }

    _asyncReadyCallback(nm, res) {
        this._network_monitor.can_reach_finish(res);

        if (this._networkTimeoutId) {
            GLib.source_remove(this._networkTimeoutId);
            this._networkTimeoutId = 0;
        }

        // If the network is up, perform update check
        this._updateManager.checkUpdates();
    }

    destroy() {
        if (this._networkTimeoutId) {
            GLib.source_remove(this._networkTimeoutId);
            this._networkTimeoutId = 0;
        }
    }
};

var DirectoryMonitor = class DirectoryMonitor{

    constructor(updateManager) {
        this._updateManager = updateManager;

        this.start();
    }

    start() {
        this.stop();

        let directory = '/var/lib/apt/lists';
        this._apt_dir = Gio.file_new_for_path(directory);
        this._apt_monitor = this._apt_dir.monitor_directory(0, null);
        this._apt_monitorId = this._apt_monitor.connect('changed',
                                                        this._onFolderChanged.bind(this));

        directory = '/var/lib/dpkg';
        this._dpkg_dir = Gio.file_new_for_path(directory);
        this._dpkg_monitor = this._dpkg_dir.monitor_directory(0, null);
        this._dpkg_monitorId = this._dpkg_monitor.connect('changed',
                                                          this._onFolderChanged.bind(this));
    }

    stop() {
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
    }

    _onFolderChanged() {
        // Apt cache has changed! Let's schedule a check in a few seconds
        if (this._folderMonitorId)
            GLib.source_remove(this._folderMonitorId);
        let timeout = 10;
        this._folderMonitorId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                                                        timeout,
                                                        () => {
                                                            let checkUpgrades = 0;
                                                            this._updateManager._dontUpdateDate = true;
                                                            this._updateManager._launchScript(checkUpgrades);
                                                            this._folderMonitorId = null;
                                                            return false;
                                                        });
    }

    destroy() {
        this.stop();
    }
};
