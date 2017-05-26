const Format = imports.format;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const UpdateManager = Me.imports.updateManager;
const Utils = Me.imports.utils;

function init() {
    String.prototype.format = Format.format;
    Utils.initTranslations('apt-update-indicator');
}

let updateManager;

function enable() {
    updateManager = new UpdateManager.UpdateManager();
}

function disable() {
    updateManager.destroy();
    updateManager = null;
}
