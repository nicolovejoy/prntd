# #14 colour catalog
- Availability: variant counts as available when in_stock is true AND availability_status has US = in_stock. Printful has no discontinued flag; absence from /products/{id} is the signal.
- Rule: colour must have all sold sizes (not all API sizes, e.g. XS/3XL/5XL ignored). Result: 3001 25 -> 83; 917 and 360 already had every qualifying colour (API lists 5 and 22).
- Ordering: BLANKS = BLANK_DEFINITIONS.map(sort shirts' colors by luminance desc, name tiebreak). Chosen over reordering data: adding a colour anywhere keeps order; test also asserts it.
- BACKGROUND_PALETTE was `getBlankOrThrow(DEFAULT).colors`; now pinned literal; test snapshot + hex parity with 3001.
- 6400 existing hexes were estimates that differ from color_code; replaced with Printful's (names/ids untouched). 3001 and 917 hexes already matched.
- Picker swatches w-10 -> w-11 (44px) on phone; aria-pressed added. Not committed: this ledger (.superpowers not gitignored).
