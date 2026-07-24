# Stable: the pinned dataset served by the site's normal routes.
AT_FOLDER = "../andors-trail/AndorsTrail/"
# Dev: always tracks the game repo's live master, served under /dev.
AT_FOLDER_DEV = "../andors-trail-dev/AndorsTrail/"

gen:
	mkdir public/backgrounds || true
	node bin/generateMapImages.js
gen_dev:
	mkdir -p public/dev/backgrounds
	AT_PUBLIC_DIR=./public/dev node bin/generateMapImages.js
gen_grave:
	mkdir public/backgrounds || true
	node bin/generateMapImages.js graveyard1
link:
	rm public/[rxdv][arm]* || true
	ln -s "../${AT_FOLDER}res/values" "public/values"
	ln -s "../${AT_FOLDER}res/xml" "public/xml"
	ln -s "../${AT_FOLDER}res/drawable" "public/drawable"
	ln -s "../${AT_FOLDER}res/raw" "public/raw"
link_dev:
	mkdir -p public/dev
	rm public/dev/[rxdv][arm]* || true
	ln -s "../../${AT_FOLDER_DEV}res/values" "public/dev/values"
	ln -s "../../${AT_FOLDER_DEV}res/xml" "public/dev/xml"
	ln -s "../../${AT_FOLDER_DEV}res/drawable" "public/dev/drawable"
	ln -s "../../${AT_FOLDER_DEV}res/raw" "public/dev/raw"
run:
	npm start