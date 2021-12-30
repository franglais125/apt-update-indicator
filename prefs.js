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
    settings.bind('show-critical-updates',
                  buildable.get_object('urgent_updates_switch'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);

    // Hours, days or weeks
    buildable.get_object('interval_unit_combo').connect('changed', function(widget) {
        settings.set_enum('interval-unit', widget.get_active());
    });
    buildable.get_object('interval_unit_combo').set_active(settings.get_enum('interval-unit'));

    // Create dialog for the indicator settings
    buildable.get_object('indicator_button').connect('clicked', function() {

        let dialog = new Gtk.Dialog({ title: _('Indicator options'),
                                      transient_for: box.get_toplevel(),
                                      use_header_bar: true,
                                      modal: true });

        let sub_box = buildable.get_object('indicator_dialog');
        dialog.get_content_area().add(sub_box);

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

        dialog.connect('response', (dialog, id) => {
            // remove the settings box so it doesn't get destroyed;
            dialog.get_content_area().remove(sub_box);
            dialog.destroy();
            return;
        });

        dialog.show_all();

    });

    // Create dialog for the notification settings
    buildable.get_object('notifications_button').connect('clicked', function() {

        let dialog = new Gtk.Dialog({ title: _('Notification options'),
                                      transient_for: box.get_toplevel(),
                                      use_header_bar: true,
                                      modal: true });

        let sub_box = buildable.get_object('notifications_dialog');
        dialog.get_content_area().add(sub_box);

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

        dialog.connect('response', (dialog, id) => {
            // remove the settings box so it doesn't get destroyed;
            dialog.get_content_area().remove(sub_box);
            dialog.destroy();
            return;
        });

        dialog.show_all();

    });

    // Shortcut
    settings.bind('shortcut-text',
                  buildable.get_object('shortcut_entry'),
                  'text',
                  Gio.SettingsBindFlags.DEFAULT);
    // We need to update the shortcut 'strv' when the text is modified
    settings.connect('changed::shortcut-text', function() {setShortcut(settings);});
    settings.bind('use-shortcut',
                  buildable.get_object('use_shortcut'),
                  'active',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('use-shortcut',
                  buildable.get_object('shortcut_entry'),
                  'sensitive',
                  Gio.SettingsBindFlags.DEFAULT);

    // Advanced settings tab:
    // Update method
    buildable.get_object('update_cmd_options').connect('changed', function(widget) {
        settings.set_enum('update-cmd-options', widget.get_active());
    });

    buildable.get_object('update_cmd_options').set_active(settings.get_enum('update-cmd-options'));
    if (settings.get_enum('update-cmd-options') != 3) {
        buildable.get_object('update_cmd_button').set_sensitive(false);
    }

    settings.connect('changed::update-cmd-options', function() {
        if (settings.get_enum('update-cmd-options') == 3)
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

        dialog.connect('response', (dialog, id) => {
            // remove the settings box so it doesn't get destroyed;
            dialog.get_content_area().remove(sub_box);
            dialog.destroy();
            return;
        });

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
    buildable.get_object('reset_button').connect('clicked', () => {
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
    });


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

    /*
     * Ignore list tab:
     * */
    // Set up the List of packages
    let column = new Gtk.TreeViewColumn();
    column.set_title(_('Package name'));
    buildable.get_object('ignore_list_treeview').append_column(column);

    let renderer = new Gtk.CellRendererText();
    column.pack_start(renderer, null);

    column.set_cell_data_func(renderer, function() {
        arguments[1].markup = arguments[2].get_value(arguments[3], 0);
    });

    let listStore = buildable.get_object('ignore_list_store');
    let treeview  = buildable.get_object('ignore_list_treeview');
    refreshUI(listStore, treeview, settings);
    settings.connect(
        'changed::ignore-list',
        function() {refreshUI(listStore, treeview, settings);}
    );

    buildable.get_object('treeview_selection').connect(
        'changed',
        function(selection) {selectionChanged(selection, listStore);}
    );

    // Toolbar
    buildable.get_object('ignore_list_toolbutton_add').connect(
        'clicked',
        function() {
            let dialog = new Gtk.Dialog({ title: _('Add entry to ignore list'),
                                          transient_for: box.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            let sub_box = buildable.get_object('ignore_list_add_dialog');
            dialog.get_content_area().add(sub_box);

            // Objects
            let entry = buildable.get_object('ignore_list_add_entry');
            let saveButton = buildable.get_object('ignore_list_add_button_save');
            let cancelButton = buildable.get_object('ignore_list_add_button_cancel');

            // Clean the entry in case it was already used
            entry.set_text('');
            entry.connect('icon-release', () => {this.set_text('');});

            let saveButtonId = saveButton.connect(
                'clicked',
                function() {
                    let name = entry.get_text();
                    let entries = settings.get_string('ignore-list');

                    if (entries.length > 0)
                        entries = entries + '; ' + name;
                    else
                        entries = name;

                    // Split, order alphabetically, remove duplicates and join
                    entries = splitEntries(entries);
                    entries.sort();
                    entries = entries.filter(function(item, pos, ary) {
                            return !pos || item != ary[pos - 1];
                        });
                    entries = entries.join('; ');

                    settings.set_string('ignore-list', entries);

                    close();
                }
            );

            let cancelButtonId = cancelButton.connect(
                'clicked',
                close
            );

            dialog.connect('response', (dialog, id) => {
                close();
            });

            dialog.show_all();

            function close() {
                buildable.get_object('ignore_list_add_button_save').disconnect(saveButtonId);
                buildable.get_object('ignore_list_add_button_cancel').disconnect(cancelButtonId);

                // remove the settings box so it doesn't get destroyed
                dialog.get_content_area().remove(sub_box);
                dialog.destroy();
                return;
            }
        }
    );

    buildable.get_object('ignore_list_toolbutton_remove').connect(
        'clicked',
        function() {removeEntry(settings);}
    );

    buildable.get_object('ignore_list_toolbutton_edit').connect(
        'clicked',
        function() {
            if (selected_entry < 0) return;

            let dialog = new Gtk.Dialog({ title: _('Edit entry'),
                                          transient_for: box.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            let sub_box = buildable.get_object('ignore_list_edit_dialog');
            dialog.get_content_area().add(sub_box);

            // Objects
            let entries = settings.get_string('ignore-list');
            if (!entries.length) return;
            entries = splitEntries(entries);

            let entry = buildable.get_object('ignore_list_edit_entry');
            let saveButton = buildable.get_object('ignore_list_edit_button_save');
            let cancelButton = buildable.get_object('ignore_list_edit_button_cancel');

            // Clean the entry in case it was already used
            entry.set_text(entries[selected_entry]);
            entry.connect('icon-release', () => {this.set_text('');});

            let saveButtonId = saveButton.connect(
                'clicked',
                function() {
                    let name = entry.get_text();
                    let entries = settings.get_string('ignore-list');

                    if (entries.length > 0)
                        entries = entries + '; ' + name;
                    else
                        entries = name;

                    // Split, order alphabetically, remove duplicates and join
                    entries = splitEntries(entries);
                    entries.splice(selected_entry, 1);
                    entries.sort();
                    entries = entries.filter(function(item, pos, ary) {
                            return !pos || item != ary[pos - 1];
                        });
                    entries = entries.join('; ');

                    settings.set_string('ignore-list', entries);

                    close();
                }
            );

            let cancelButtonId = cancelButton.connect(
                'clicked',
                close
            );

            dialog.connect('response', (dialog, id) => {
                close();
            });

            dialog.show_all();

            function close() {
                buildable.get_object('ignore_list_edit_button_save').disconnect(saveButtonId);
                buildable.get_object('ignore_list_edit_button_cancel').disconnect(cancelButtonId);

                // remove the settings box so it doesn't get destroyed
                dialog.get_content_area().remove(sub_box);
                dialog.destroy();
                return;
            }
        }
    );

    // box.show_all();

    return box;
};

function setShortcut(settings) {
    let shortcut_text = settings.get_string('shortcut-text');
    let [key, mods] = Gtk.accelerator_parse(shortcut_text);

    if (Gtk.accelerator_valid(key, mods)) {
        let shortcut = Gtk.accelerator_name(key, mods);
        settings.set_strv('apt-update-indicator-shortcut', [shortcut]);
    }
    else {
        settings.set_strv('apt-update-indicator-shortcut', []);
    }
}

let selected_entry = 0;

function selectionChanged(select, listStore) {
    let a = select.get_selected_rows(listStore)[0][0];

    if (a !== undefined)
        selected_entry = parseInt(a.to_string());
}

function removeEntry(settings) {
    let entries = settings.get_string('ignore-list');
    entries = splitEntries(entries);

    if (!entries.length || selected_entry < 0)
        return 0;

    if (entries.length > 0)
        entries.splice(selected_entry, 1);

    if (entries.length > 1)
        entries = entries.join('; ');
    else if (entries[0])
        entries = entries[0];
    else
        entries = '';

    settings.set_string('ignore-list', entries);

    return 0;
}

function splitEntries(entries) {
    entries = entries.split('; ');

    if (entries.length === 0)
        entries = [];

    if (entries.length > 0 && typeof entries != 'object')
        entries = [entries];

    return entries;
}

let list = null;
function refreshUI(listStore, treeview, settings) {
    let restoreForced = selected_entry;
    let entries = settings.get_string('ignore-list');
    if (list != entries) {
        if (listStore !== undefined)
            listStore.clear();

        if (entries.length > 0) {
            entries = String(entries).split('; ');

            if (entries && typeof entries == 'string')
                entries = [entries];

            let current = listStore.get_iter_first();

            for (let i in entries) {
                current = listStore.append();
                listStore.set_value(current, 0, entries[i]);
            }
        }

        list = entries;
    }

    selected_entry = restoreForced;
    changeSelection(treeview, entries);
}

function changeSelection(treeview, entries) {
    if (selected_entry < 0 || !entries.length)
        return;

    let max = entries.length - 1;
    if (selected_entry > max)
        selected_entry = max;

    let path = selected_entry;
    path = Gtk.TreePath.new_from_string(String(path));
    treeview.get_selection().select_path(path);
}
