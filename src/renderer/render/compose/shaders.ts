export const COMPOSE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const COMPOSE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_mask;
uniform sampler2D u_ground;
uniform sampler2D u_water;
uniform int u_threshold;
uniform float u_scale;
uniform float u_tx;
uniform float u_ty;
uniform int u_mapW;
uniform int u_mapH;
out vec4 o_out;
void main() {
  int mu = int(floor((gl_FragCoord.x - u_tx) / u_scale));
  int mv = int(floor((gl_FragCoord.y - u_ty) / u_scale));
  if (mu < 0 || mv < 0 || mu >= u_mapW || mv >= u_mapH) {
    o_out = vec4(0.0);
    return;
  }
  ivec2 mc = ivec2(mu, mv);
  int a = int(texelFetch(u_mask, mc, 0).a * 255.0 + 0.5);
  vec3 rgb = a >= u_threshold ? texelFetch(u_ground, mc, 0).rgb : texelFetch(u_water, mc, 0).rgb;
  o_out = vec4(rgb, 1.0);
}
`;
