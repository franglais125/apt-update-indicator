#!/bin/bash

# Run this script with care!!
# The following two files will be overwritten:


# Create the script file
SCR_FILE=/usr/local/bin/updater

sudo env SCR_FILE=${SCR_FILE} sh -c 'echo "#!/bin/bash\napt update" > ${SCR_FILE}'
sudo chmod 0755 ${SCR_FILE}


# Update the sudo permission
SUD_FILE=/etc/sudoers.d/update
sudo env SCR_FILE=$SCR_FILE SUD_FILE=${SUD_FILE} THIS_USER=$USER sh -c 'echo "Cmnd_Alias UPDATER_ONLY = "${SCR_FILE}"\n%"$THIS_USER" ALL= NOPASSWD: UPDATER_ONLY" > ${SUD_FILE}'
sudo chmod 0440 ${SUD_FILE}
