const Gettext = imports.gettext;
const Lang = imports.lang;

const Gio = imports.gi.Gio;

const Config = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;

var SignalsHandlerFlags = {
    NONE: 0,
    CONNECT_AFTER: 1
};

function getSettings() {
	let extension = ExtensionUtils.getCurrentExtension();
	let schema = 'org.gnome.shell.extensions.apt-update-indicator';

	const GioSSS = Gio.SettingsSchemaSource;

	// check if this extension was built with "make zip-file", and thus
	// has the schema files in a subfolder
	// otherwise assume that extension has been installed in the
	// same prefix as gnome-shell (and therefore schemas are available
	// in the standard folders)
	let schemaDir = extension.dir.get_child('schemas');
	let schemaSource;
	if (schemaDir.query_exists(null)) {
		schemaSource = GioSSS.new_from_directory(schemaDir.get_path(),
				GioSSS.get_default(),
				false);
	} else {
		schemaSource = GioSSS.get_default();
	}

	let schemaObj = schemaSource.lookup(schema, true);
	if (!schemaObj) {
		throw new Error('Schema ' + schema + ' could not be found for extension ' +
				extension.metadata.uuid + '. Please check your installation.');
	}

	return new Gio.Settings({settings_schema: schemaObj});
}

/**
 * initTranslations:
 * @domain: (optional): the gettext domain to use
 *
 * Initialize Gettext to load translations from extensionsdir/locale.
 * If @domain is not provided, it will be taken from metadata['gettext-domain']
 */
function initTranslations(domain) {
	let extension = ExtensionUtils.getCurrentExtension();

	domain = domain || extension.metadata['gettext-domain'];

	// check if this extension was built with "make zip-file", and thus
	// has the locale files in a subfolder
	// otherwise assume that extension has been installed in the
	// same prefix as gnome-shell
	let localeDir = extension.dir.get_child('locale');
	if (localeDir.query_exists(null))
		Gettext.bindtextdomain(domain, localeDir.get_path());
	else
		Gettext.bindtextdomain(domain, Config.LOCALEDIR);
}

/**
 * Simplify global signals and function injections handling
 * abstract class
 */
const BasicHandler = class DashToDock_BasicHandler {

    constructor() {
        this._storage = new Object();
    }

    add(/* unlimited 3-long array arguments */) {
        // Convert arguments object to array, concatenate with generic
        // Call addWithLabel with ags as if they were passed arguments
        this.addWithLabel('generic', ...arguments);
    }

    destroy() {
        for( let label in this._storage )
            this.removeWithLabel(label);
    }

    addWithLabel(label /* plus unlimited 3-long array arguments*/) {
        if (this._storage[label] == undefined)
            this._storage[label] = new Array();

        // Skip first element of the arguments
        for (let i = 1; i < arguments.length; i++) {
            let item = this._storage[label];
            try {
                item.push(this._create(arguments[i]));
            } catch (e) {
                logError(e);
            }
        }
    }

    removeWithLabel(label) {
        if (this._storage[label]) {
            for (let i = 0; i < this._storage[label].length; i++)
                this._remove(this._storage[label][i]);

            delete this._storage[label];
        }
    }

    // Virtual methods to be implemented by subclass

    /**
     * Create single element to be stored in the storage structure
     */
    _create(item) {
        throw new GObject.NotImplementedError(`_create in ${this.constructor.name}`);
    }

    /**
     * Correctly delete single element
     */
    _remove(item) {
        throw new GObject.NotImplementedError(`_remove in ${this.constructor.name}`);
    }
};

/**
 * Manage global signals
 */
var GlobalSignalsHandler = class DashToDock_GlobalSignalHandler extends BasicHandler {

    _create(item) {
        let object = item[0];
        let event = item[1];
        let callback = item[2]
        let flags = item.length > 3 ? item[3] : SignalsHandlerFlags.NONE;

        if (!object)
            throw new Error('Impossible to connect to an invalid object');

        let after = flags == SignalsHandlerFlags.CONNECT_AFTER;
        let connector = after ? object.connect_after : object.connect;

        if (!connector) {
            throw new Error(`Requested to connect to signal '${event}', ` +
                `but no implementation for 'connect${after ? '_after' : ''}' `+
                `found in ${object.constructor.name}`);
        }

        let id = connector.call(object, event, callback);

        return [object, id];
    }

    _remove(item) {
         item[0].disconnect(item[1]);
    }
};
