# azlanyaacob92.github.io

## Chemulate Orbitals

Interactive atomic-orbital visualiser for 1s to 5p (27 orbitals, 54 electrons, up to Xe).
Live at <https://azlanyaacob92.github.io/orbitalvisualiser/>; source in its own repo,
[AzlanYaacob92/orbitalvisualiser](https://github.com/AzlanYaacob92/orbitalvisualiser).

- Orbital energy diagram you can slice by orbital, subshell or shell, showing the n, l, mₗ, mₛ that belong to the selection and why.
- Fill orbitals with electrons (Pauli, Hund and Aufbau feedback, 54-electron cap); load any ground state from H to Xe, including the Cr, Cu, Nb, Mo, Ru, Rh, Pd and Ag anomalies.
- 3-D x/y/z viewer: a subshell or shell draws all its orbitals solid; an orbital picked inside a subshell is solid and its siblings are transparent. Size grows with n.

### Run

No build step. In a clone of the orbitalvisualiser repo, serve the folder and open `index.html`:

    python -m http.server

Tests for the data layer: `node test-chemistry.js`

### Simplifications (also stated in the app)

- Shapes show the angular probability distribution only; radial nodes are not drawn.
- Real orbitals, not complex ones. mₗ labels on px/py/d orbitals are a labelling convention.
- Energy axis is schematic (many-electron Madelung order, approximate and reversed in ions).
- Size grows as n^0.75, not the true n², so 5p stays on screen.

`CONTRACT.md` in the orbitalvisualiser repo records the file/API contract the app was built against.
