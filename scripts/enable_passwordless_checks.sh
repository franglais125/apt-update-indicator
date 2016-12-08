#!/bin/bash

# This script shouldn't be run as root
if [ "$USER" = "root" ]; then
  echo "Please run as user, not root"
  echo "E.g. don't use sudo!"
  echo "Aborting"
  exit 1
fi

# Run this script with care!!
# The following two files will be overwritten:
SCR_FILE=/usr/local/bin/updater
SUD_FILE=/etc/sudoers.d/update


# Create the script file
sudo env SCR_FILE=${SCR_FILE} sh -c 'echo "#!/bin/bash\napt update" > ${SCR_FILE}'
sudo chmod 0755 ${SCR_FILE}


# Update the sudo permission
sudo env SCR_FILE=$SCR_FILE SUD_FILE=${SUD_FILE} THIS_USER=$USER sh -c 'echo "Cmnd_Alias UPDATER_ONLY = "${SCR_FILE}"\n%"$THIS_USER" ALL= NOPASSWD: UPDATER_ONLY" > ${SUD_FILE}'
sudo chmod 0440 ${SUD_FILE}
