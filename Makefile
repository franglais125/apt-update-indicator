# Basic Makefile

UUID = apt-update-indicator@franglais125.gmail.com
BASE_MODULES = extension.js LICENCE.txt metadata.json prefs.js prefs.xml stylesheet.css utils.js
EXTRA_MEDIA = media/logo.png
TOLOCALIZE = extension.js
MSGSRC = $(wildcard po/*.po)
INSTALLNAME = apt-update-indicator@franglais125.gmail.com
ifeq ($(strip $(DESTDIR)),)
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
	RMTMP = echo Not deleting tmp as installation is local
else
	INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
	RMTMP = rm -rf ./_build/tmp
endif

# The command line passed variable VERSION is used to set the version string
# in the metadata and in the generated zip-file. If no VERSION is passed, the
# current commit SHA1 is used as version number in the metadata while the
# generated zip file has no string attached.
ifdef VERSION
	VSTRING = _v$(VERSION)
else
	VERSION = $(shell git rev-parse HEAD)
	VSTRING =
endif

all: extension

clean:
	rm -f ./schemas/gschemas.compiled
	rm -f ./po/*.mo

extension: ./schemas/gschemas.compiled $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.apt-update-indicator.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/aptupdateindicator.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/aptupdateindicator.pot; \
	done;

./po/aptupdateindicator.pot: $(TOLOCALIZE) prefs.xml
	mkdir -p po
	xgettext -k_ -kN_ -o po/aptupdateindicator.pot --package-name "Apt Update Indicator" $(TOLOCALIZE)
	intltool-extract --type=gettext/glade prefs.xml
	xgettext -k_ -kN_ --join-existing -o po/aptupdateindicator.pot prefs.xml.h

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

install: install-local

install-local: _build
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)/tmp
	cp -r $(INSTALLBASE)/$(INSTALLNAME)/tmp ./_build/.
	$(RMTMP)
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
	-rm -fR _build
	echo done

zip-file: _build
	cd _build ; \
	zip -qr "$(UUID)$(VSTRING).zip" .
	mv _build/$(UUID)$(VSTRING).zip ./
	-rm -fR _build

_build: all
	-rm -fR ./_build
	mkdir -p _build
	cp $(BASE_MODULES) _build
	mkdir -p _build/scripts
	cp scripts/*.sh _build/scripts/
	mkdir -p _build/media
	cp $(EXTRA_MEDIA) _build/media/
	mkdir -p _build/schemas
	cp schemas/*.xml _build/schemas/
	cp schemas/gschemas.compiled _build/schemas/
	mkdir -p _build/locale
	for l in $(MSGSRC:.po=.mo) ; do \
		lf=_build/locale/`basename $$l .mo`; \
		mkdir -p $$lf; \
		mkdir -p $$lf/LC_MESSAGES; \
		cp $$l $$lf/LC_MESSAGES/aptupdateindicator.mo; \
	done;
	sed -i 's/"version": -1/"version": "$(VERSION)"/'  _build/metadata.json;
