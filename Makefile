UUID := winter-theme@zeroze01
SRC := $(UUID)
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: schemas install uninstall enable disable pack preview scene check test clean

# The compiled schema must sit next to the XML; the shell does not compile it.
schemas:
	glib-compile-schemas --strict $(SRC)/schemas

# Symlink the source tree so edits apply on the next login without reinstalling.
install: schemas
	mkdir -p $(dir $(INSTALL_DIR))
	ln -sfn $(CURDIR)/$(SRC) $(INSTALL_DIR)
	@echo "Installed. Log out and back in, then run: make enable"

uninstall:
	rm -f $(INSTALL_DIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

# Zip for sharing or for `gnome-extensions install`.
pack: schemas
	gnome-extensions pack --force --extra-source=lib --extra-source=assets $(SRC)

# Screenshots from a throwaway headless shell; see tools/preview.sh for options.
preview:
	tools/preview.sh preview

# Just the scenery, without a shell.
scene:
	mkdir -p preview
	gjs -m tools/render-scene.js preview/scene-day.png day
	gjs -m tools/render-scene.js preview/scene-night.png night

check:
	@for f in $(SRC)/*.js $(SRC)/lib/*.js tools/*.js; do \
		node --check --input-type=module < $$f || exit 1; \
	done; echo "syntax ok"

test:
	gjs -m tools/test-countdown.js

clean:
	rm -rf preview $(UUID).shell-extension.zip
