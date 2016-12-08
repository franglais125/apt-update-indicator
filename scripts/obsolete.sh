#!/bin/bash

######################################
#                                    #
#   Check for obsolete packages      #
#                                    #
######################################

ONLY_PRINT=$1
# Paths and files
path=~/.local/share/gnome-shell/extensions/apt-update-indicator@franglais125.gmail.com/tmp/

file=${path}obsolete.list

# Check for local or obsolete packages
if [ "$ONLY_PRINT" -lt 1 ]; then
  apt-show-versions | grep 'No available version\|newer than version in archive\|*manually*' | awk '{print $1}' > ${file}
fi

# Print!
if [ -f ${file} ]; then
  num=`cat ${file} | wc -l`
  if [ "$num" -gt 500 ]; then
    echo "** Too many! Showing only 500 **"
  fi
  head -500 $file
fi
