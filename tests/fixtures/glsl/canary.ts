// This fixture must fail the external offline GLSL check.
export const BROKEN_FRAGMENT = `#version 300 es
precision highp float;
out vec4 o_color;
void main( {
  o_color = vec4(1.0);
}
`;
