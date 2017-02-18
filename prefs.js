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

const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const Gettext = imports.gettext.domain('apt-update-indicator');
const _ = Gettext.gettext;

let settings;

function init() {
    settings = Utils.getSettings(Me);
    Utils.initTranslations("apt-update-indicator");
}

function buildPrefsWidget(){

    // Prepare labels and controls
    let buildable = new Gtk.Builder();
    buildable.add_from_file( Me.dir.get_path() + '/Settings.ui' );
    let box = buildable.get_object('prefs_widget');

    buildable.get_object('extension_version').set_text(Me.metadata.version.toString());

    // Basic settings tab:
    // Check updates
    settings.bind('check-interval',
                  buildable.get_object('interval'),
                  'value',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('strip-versions',
                  buildable.get_object('strip_versions_switch'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    // Indicator
    settings.bind('always-visible',
                  buildable.get_object('always_visible'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('show-count',
                  buildable.get_object('show_count'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('auto-expand-list',
                  buildable.get_object('auto_expand_list'),
                 'value',
                  Gio.SettingsBindFlags.DEFAULT);
    // Notifications
    settings.bind('notify',
                  buildable.get_object('notifications'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('transient',
                  buildable.get_object('transient_notifications'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('verbosity',
                  buildable.get_object('verbosity'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);

    settings.bind('notify',
                  buildable.get_object('transient_notifications'),
                  'sensitive',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('notify',
                  buildable.get_object('verbosity'),
                  'sensitive',
                  Gio.SettingsBindFlags.DEFAULT);

    // Advanced settings tab:
    // Update method
    buildable.get_object('update_cmd_options').connect('changed', function(widget) {
        settings.set_enum('update-cmd-options', widget.get_active());
    });

    buildable.get_object('update_cmd_options').set_active(settings.get_enum('update-cmd-options'));
    if (settings.get_enum('update-cmd-options') != 2) {
        buildable.get_object('update_cmd_button').set_sensitive(false);
    }

    settings.connect('changed::update-cmd-options', function() {
        if (settings.get_enum('update-cmd-options') == 2)
            buildable.get_object('update_cmd_button').set_sensitive(true);
        else
            buildable.get_object('update_cmd_button').set_sensitive(false);
    });


    // Create dialog for custom command for updating
    buildable.get_object('update_cmd_button').connect('clicked', function() {

        let dialog = new Gtk.Dialog({ title: _('Custom command for updates'),
                                      transient_for: box.get_toplevel(),
                                      use_header_bar: true,
                                      modal: true });

        let sub_box = buildable.get_object('custom_command_dialog');
        dialog.get_content_area().add(sub_box);

        settings.bind('output-on-terminal',
                      buildable.get_object('output_on_terminal_switch'),
                      'active',
                      Gio.SettingsBindFlags.DEFAULT);
        settings.bind('terminal',
                      buildable.get_object('terminal_entry'),
                      'text',
                      Gio.SettingsBindFlags.DEFAULT);
        settings.bind('update-cmd',
                      buildable.get_object('field_updatecmd'),
                      'text',
                      Gio.SettingsBindFlags.DEFAULT);

        settings.bind('output-on-terminal',
                      buildable.get_object('terminal_entry'),
                      'sensitive',
                      Gio.SettingsBindFlags.GET);

        dialog.connect('response', Lang.bind(this, function(dialog, id) {
            // remove the settings box so it doesn't get destroyed;
            dialog.get_content_area().remove(sub_box);
            dialog.destroy();
            return;
        }));

        dialog.show_all();

    });

    // Check commands
    settings.bind('use-custom-cmd',
                  buildable.get_object('use_custom_cmd_switch'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('check-cmd-custom',
                  buildable.get_object('field_checkcmd_custom'),
                  'text',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('use-custom-cmd',
                  buildable.get_object('field_checkcmd_custom'),
                  'sensitive',
                  Gio.SettingsBindFlags.DEFAULT);

    // Reset button
    buildable.get_object('reset_button').connect('clicked', Lang.bind(this, function() {
        // restore default settings for the relevant keys
        let keys = ['terminal',
                    'output-on-terminal',
                    'update-cmd',
                    'update-cmd-options',
                    'use-custom-cmd',
                    'check-cmd-custom'];
        keys.forEach(function(val) {
            settings.set_value(val, settings.get_default_value(val));
        }, this);
        // This one needs to be refreshed manually
        buildable.get_object('update_cmd_options').set_active(settings.get_enum('update-cmd-options'));
    }));


    // Package status tab:
    settings.bind('new-packages',
                  buildable.get_object('new_packages_switch'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('obsolete-packages',
                  buildable.get_object('obsolete_packages_switch'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('residual-packages',
                  buildable.get_object('residual_packages_switch'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('autoremovable-packages',
                  buildable.get_object('autoremovable_packages_switch'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);

    box.show_all();

    return box;
};

