#!/bin/bash
##################################################################################
#    This file is part of Update Indicator
#    Update Indicator is free software: you can redistribute it and/or modify
#    it under the terms of the GNU General Public License as published by
#    the Free Software Foundation, either version 3 of the License, or
#    (at your option) any later version.
#    Update Indicator is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU General Public License for more details.
#    You should have received a copy of the GNU General Public License
#    along with Update Indicator.  If not, see <http://www.gnu.org/licenses/>.
#    Copyright 2016, 2017 Fran Glais
##################################################################################

######################################
#                                    #
#   Check for obsolete packages      #
#                                    #
######################################

ONLY_PRINT=$1
# Paths and files
path=~/.local/share/gnome-shell/extensions/apt-update-indicator@franglais125.gmail.com/tmp/

# Create the directory if it doesn't exist
mkdir -p ${path}

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
