#!/bin/bash

######################################
#                                    #
#   Check for new packages           #
#                                    #
######################################

path=~/.local/share/gnome-shell/extensions/apt-update-indicator@franglais125.gmail.com/tmp/

mkdir -p ${path}

file_all=${path}all-packages.list
file=${path}new-packages.list
temporary=${path}temporary.list

first_run=false

#Prepare
if [ -f ${file_all} ]; then
  mv ${file_all} ${file_all}.old
else
  first_run=true
fi

apt-cache pkgnames --generate | sort > ${file_all}
if [ "$first_run" = true ]; then
  exit 0
fi
# checks for differences         | prints 2d output | remove empty lines
diff ${file_all} ${file_all}.old | awk '{print $2}' | grep -v -e '^$' > ${temporary}

# Check that the difference doesn't come from the `.old` file
touch ${file}.test
rm ${file}.test
touch ${file}.test
for line in $(cat ${temporary})
do
  if grep -Fxq $line ${file_all}
  then
    echo $line >> ${file}.test
  fi
done

#Erase the file if there are new packages
num=`cat ${file}.test | wc -l`

if [ "$num" -gt 0 ]
then
  mv ${file}.test ${file}
fi

if [ ! -f ${file} ]; then
  touch ${file}
fi

# Print!
cat $file
