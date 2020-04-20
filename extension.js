const ExtensionUtils = imports.misc.extensionUtils;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const UpdateManager = Me.imports.updateManager;
const Utils = Me.imports.utils;

function init() {
    ExtensionUtils.initTranslations('apt-update-indicator');
}

var updateManager;

function enable() {
    updateManager = new UpdateManager.UpdateManager();
}

function disable() {
    updateManager.destroy();
    updateManager = null;
}
