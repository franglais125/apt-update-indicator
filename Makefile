# Basic Makefile

UUID = apt-update-indicator@franglais125.gmail.com
BASE_MODULES = extension.js indicator.js LICENCE.txt metadata.json monitors.js prefs.js Settings.ui stylesheet.css updateManager.js utils.js
EXTRA_MEDIA = media/logo.png
TOLOCALIZE = indicator.js monitors.js updateManager.js
MSGSRC = $(wildcard po/*.po)
INSTALLNAME = apt-update-indicator@franglais125.gmail.com
ifeq ($(strip $(DESTDIR)),)
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
	RMTMP = echo Not deleting tmp as installation is local
else
	INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
	RMTMP = rm -rf ./_build/tmp
endif

all: extension

clean:
	rm -f ./schemas/gschemas.compiled
	rm -f ./po/*.mo

extension: ./schemas/gschemas.compiled $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.apt-update-indicator.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/apt-update-indicator.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/apt-update-indicator.pot; \
	done;

./po/apt-update-indicator.pot: $(TOLOCALIZE) Settings.ui
	mkdir -p po
	xgettext -k_ -kN_ -o po/apt-update-indicator.pot --package-name "Apt Update Indicator" $(TOLOCALIZE)
	intltool-extract --type=gettext/glade Settings.ui
	xgettext -k_ -kN_ --join-existing -o po/apt-update-indicator.pot Settings.ui.h

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
		cp $$l $$lf/LC_MESSAGES/apt-update-indicator.mo; \
	done;
