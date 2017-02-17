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
#    Copyright 2017 Fran Glais
##################################################################################

######################################
#                                    #
#         Check for updates          #
#      and print package names       #
#                                    #
######################################

# Get updates list   | Print after "Results:"      | remove line if 0 updates       | print package names only
pkcon get-updates -p | awk '/Results:/{y=1;next}y' | grep -v "no updates available" | awk '{print $2}'
