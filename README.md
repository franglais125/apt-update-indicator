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

### v4
- Complete redesign of the Settings UI
- Check for internet connection before looking for new updates
- Remove the cancel button: process runs as root
- Improve date display
- Add a system for proper handling of global signals

### v3
- Add date and time of the last update to the menu
- Some bug fixes and a few Synaptic-like features listed below:
- check for new packages in repository
- check for local or obsolete packages
- check for residual config files
- check for autoremovable packages

### v2
- add option to check for updates without password

### v1
- first version released


## Credits
Forked from https://github.com/RaphaelRochet/arch-update !
