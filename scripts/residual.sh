#!/bin/bash

######################################
#                                    #
#   Check for residual config files  #
#                                    #
######################################

ONLY_PRINT=$1
path=~/.local/share/gnome-shell/extensions/apt-update-indicator@franglais125.gmail.com/tmp/

file=${path}residual-config.list
if [ "$ONLY_PRINT" -lt 1 ]; then
  dpkg -l | grep '^rc'| awk '{print $2}' > ${file}
fi

# Print!
if [ -f ${file} ]; then
  num=`cat ${file} | wc -l`
  if [ "$num" -gt 500 ]; then
    echo "** Too many! Showing only 500 **"
  fi
  head -500 $file
fi
