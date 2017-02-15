# apt-update-indicator
Update indicator for apt-based distributions.


## Features
- Uses "apt update" by default
- Uses "apt upgrade -y" by default to upgrade
- Optional update count display on panel
- Optional notification on new updates (defaults to off)
- Comes in English, French and Spanish so far


## One-click install
Soon to be on extensions.gnome.org:
https://extensions.gnome.org/extension/1139/apt-update-indicator/


## Manual install
To install, simply download and execute "make install"


## Changes

### v9
- Fix typo in Settings
- Fix automatic updates using minutes instead of hours
- Improve readability of notification and indicator

### v8
- Use gnome-software or update-manager to apply updates

### v7
- Change the default terminal to xterm
- Use `pkcon refresh` as the default command to check for updates

### v6
- Use standard date formatting tools
- Automatic checks are now compatible across sessions
- Use hours instead of minutes in settings
- Make use of symbolic icons to follow GNOME HIG.

### v5
- Use policykit instead of sudo for password-less checks
- Add option to show update process on a terminal
- Small fixes for scripts
- Update Spanish and French translations

### v4
- Complete redesign of the Settings UI
- Check for internet connection before looking for new updates
- Remove the cancel button: process runs as root
- Improve date display
- Add a system for proper handling of global signals

### v3
- Add date and time of the last update to the menu
- Bug fixes
- Synaptic-like features: check for new packages in repository, local or obsolete packages, residual config files and autoremovable packages

### v2
- Add option to check for updates without password

### v1
- First version


## Credits
Forked from https://github.com/RaphaelRochet/arch-update !
