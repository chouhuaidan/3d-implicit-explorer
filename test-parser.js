const { latexToGLSL } = require('./js/latex-parser.js');
const assert = require('node:assert/strict');

const examples = [
  { name: 'Sphere', latex: 'x^2+y^2+z^2=1' },
  { name: 'Torus', latex: String.raw`\left(\sqrt{x^2+z^2}-2\right)^2+y^2=0.5` },
  { name: 'Gyroid', latex: String.raw`\sin(x)\cos(y)+\sin(y)\cos(z)+\sin(z)\cos(x)=0` },
  { name: 'Schwarz P', latex: String.raw`\cos(x)+\cos(y)+\cos(z)=0` },
  { name: 'Cylinder', latex: 'x^2+z^2=1' },
  { name: 'Cone', latex: 'x^2+z^2-y^2=0' },
  { name: 'Hyperboloid', latex: 'x^2-y^2+z^2=1' },
  { name: 'Sine Waves', latex: String.raw`\sin(x)+\sin(y)+\sin(z)=1` },
  { name: 'Complex GCD', latex: String.raw`\cos\left(y\right)2^{x\sin\left(x\right)}=\log_{2}\left(\gcd\left(z,x\right)\right)` },
  { name: 'Tangled Cube', latex: 'x^{4}-5x^{2}+y^{4}-5y^{2}+z^{4}-5z^{2}+11.8=0' },
  { name: 'Heart', latex: String.raw`\left(x^2+\frac{9}{4}y^2+z^2-1\right)^3-x^2z^3-\frac{9}{80}y^2z^3=0` },
  { name: 'Cassini', latex: String.raw`\left(x^2+y^2+z^2+0.45^2\right)^2-4\cdot0.45^2\left(x^2+z^2\right)=0.1` },
  { name: 'Lattice', latex: String.raw`\cos(x)\cos(y)\cos(z)=0.3` },
  { name: 'GCD Surface', latex: String.raw`\gcd(x,z)=y` },
  { name: 'Floor Stairs', latex: String.raw`y=\floor(x)+\floor(z)` },
];

// Build the pasted Desmos expression without repeating its gradient hash.
const group = value => String.raw`\left(${value}\right)`;
const floor = value => String.raw`\operatorname{floor}${group(value)}`;
const sin = value => String.raw`\sin${group(value)}`;
const cos = value => String.raw`\cos${group(value)}`;
const coordinates = ['x', 'y', 'z'];
const indices = ['i', 'j', 'k'];
const grid = (axis, offset) => floor(coordinates[axis]) + '+' + indices[axis] + offset;
const hash = offset => {
  const dot = ['12.9898', '78.233', '37.719']
    .map((scale, axis) => group(grid(axis, offset)) + String.raw`\cdot` + scale)
    .join('+');
  const value = sin(dot) + String.raw`\cdot43758.5453`;
  return group(value + '-' + floor(value));
};
const weights = indices.map((index, axis) => {
  const coordinate = coordinates[axis];
  const fraction = group(coordinate + '-' + floor(coordinate));
  return group('1-' + index + '+' + group('2' + index + '-1') + fraction + '^{2}' + group('3-2' + fraction));
});
const azimuth = String.raw`2\pi` + hash('');
const inclination = String.raw`\pi` + hash('+1');
const distances = coordinates.map((coordinate, axis) => group(coordinate + '-' + group(grid(axis, ''))));
const gradient = group(
  distances[0] + cos(azimuth) + sin(inclination) + '+' +
  distances[1] + sin(azimuth) + sin(inclination) + '+' +
  distances[2] + cos(inclination)
);
const perlin = indices.map(index => String.raw`\sum_{${index}=0}^{1}`).join('') + weights.join('') + gradient + '=0';

if (require.main === module) {
  for (const { name, latex } of examples) {
    assert.equal(latexToGLSL(latex).error, null, name);
  }

  const result = latexToGLSL(perlin);
  assert.equal(result.error, null);
  assert.equal(result.helpers.match(/for \(float /g).length, 3);
  assert.match(result.glsl, /latexSum0\(x, y, z\)/);
  assert.match(result.helpers, /latexSum2\(x, y, z, sumIndex0, sumIndex1\)/);
  assert.match(result.helpers, /total \+= .+ \* .+ \* .+ \* .+;/);

  const scoped = latexToGLSL(String.raw`\sum\limits_{x=1}^{2}(\sum_{x=x}^{x+1}x)+x=0`);
  assert.equal(scoped.error, null);
  assert.match(scoped.helpers, /ceil\(sumIndex0\)/);
  assert.match(scoped.helpers, /total \+= sumIndex1;/);
  assert.match(scoped.glsl, /latexSum0\(x, y, z\) \+ x/);
  assert.ok(latexToGLSL(String.raw`\sum_{i=0}^{1}=0`).error);
  console.log('Parser examples and summation regressions passed.');
}

module.exports = { perlin };
