import { GdDict, GdMath, GdObject } from '../../src/core/formats/godot-var.ts';
import type { GdValue } from '../../src/core/formats/godot-var.ts';

export interface WdSyntheticOptions {
  gridNull?: boolean;
  scaleNull?: boolean;
}

function vec(x: number, y: number): GdMath {
  return new GdMath('Vector2', new Float32Array([x, y]));
}

function col(r: number, g: number, b: number, a: number): GdMath {
  return new GdMath('Color', new Float32Array([r, g, b, a]));
}

function tinyRaster(seed: number, dataPropIndex: number): GdObject {
  const data = new Uint8Array([seed, seed + 1, seed + 2, seed + 3, seed + 4, seed + 5, seed + 6, seed + 7,
    seed + 8, seed + 9, seed + 10, seed + 11, seed + 12, seed + 13, seed + 14, seed + 15]);
  const inner = new GdDict([
    ['width', 2n],
    ['height', 2n],
    ['format', 'RGBA8'],
    ['mipmaps', false],
    ['data', data],
  ]);
  const props: Array<[string, GdValue]> = [
    ['resource_local_to_scene', false],
    ['resource_name', 'synth'],
    ['data', inner],
    ['script', new GdObject('', [])],
  ];
  const dataProp = props.splice(2, 1)[0];
  props.splice(dataPropIndex, 0, dataProp);
  return new GdObject('Image', props);
}

function gridRecord(): GdDict {
  return new GdDict([
    ['pattern', 1n],
    ['layer', 0n],
    ['size', 32.5],
    ['line_width', 1.25],
    ['color', col(0.1, 0.2, 0.3, 1)],
    ['offset', vec(4, 8)],
  ]);
}

function scaleRecord(): GdDict {
  return new GdDict([
    ['position', vec(10, 20)],
    ['rotation', 0.5],
    ['colors', [col(1, 0, 0, 1), col(0, 1, 0, 1), col(0, 0, 1, 1)]],
    ['size', vec(30, 40)],
    ['segments', 8.5],
    ['line_width', 1.5],
    ['segment_distance', 100.25],
    ['numbers_display', 3n],
    ['font', 'SynthFont'],
    ['font_size', 9.5],
    ['outline_width', 1.5],
    ['font_color', col(0, 0, 0, 1)],
    ['outline_color', col(1, 1, 1, 1)],
    ['units', 'uu'],
  ]);
}

function themeRecord(): GdDict {
  return new GdDict([
    ['water_texture', 'SynthWater'],
    ['ground_texture', 'SynthGround'],
    ['water_hue', 0.11],
    ['water_saturation', -0.07],
    ['water_value', 0.22],
    ['vignette_strength', 0.33],
    ['coastal_fx_distance', 2.75],
    ['coastline_style', 1n],
    ['coastline_color', col(0.1, 0.2, 0.3, 1)],
    ['landmass_outline_color', col(0.2, 0.3, 0.4, 1)],
    ['landmass_outline_blend', 0.44],
    ['freshwater_color', col(0.3, 0.4, 0.5, 1)],
    ['freshwater_outline_color', col(0.4, 0.5, 0.6, 1)],
    ['ground_colors', [col(0.5, 0.1, 0.1, 1), col(0.1, 0.5, 0.1, 1)]],
    ['ground_color_names', ['Moss', 'Sand']],
    ['water_colors', [col(0.1, 0.1, 0.5, 1), col(0.1, 0.5, 0.5, 1)]],
    ['water_color_names', ['Deep', 'Shallow']],
    ['path_color', col(0.6, 0.5, 0.4, 1)],
    ['symbol_custom_colors', [col(1, 0, 0, 1), col(0, 1, 0, 1), col(0, 0, 1, 1)]],
    ['windrose_color', col(0.7, 0.7, 0.7, 1)],
    ['label_presets', new GdDict([
      ['City', new GdDict([['font_name', 'F1'], ['font_size', 10n]])],
      ['Town', new GdDict([['font_name', 'F2'], ['font_size', 12n]])],
      ['Water', new GdDict([['font_name', 'F3'], ['font_size', 14n]])],
    ])],
    ['color_grading', new GdDict([['strength', 0.5]])],
    ['randomize_water_mirror', true],
    ['randomize_water_offsets', false],
  ]);
}

function layersRecord(): GdDict {
  return new GdDict([
    ['enabled', true],
    ['names', ['L0', 'L1']],
    ['visibility', [true, false]],
    ['lock', [false, true]],
  ]);
}

function frameRecord(): GdDict {
  return new GdDict([
    ['enabled', true],
    ['texture', 'SynthFrame'],
    ['size', 1.25],
    ['tint', col(0.9, 0.8, 0.7, 1)],
  ]);
}

function pathRecord(): GdDict {
  return new GdDict([
    ['position', vec(1, 2)],
    ['points', '[ Vector2( 1, 2 ), Vector2( 3.5, -4 ) ]'],
    ['color', col(0.1, 0.2, 0.3, 0.4)],
    ['style', 'synth/path'],
    ['width', 2.5],
    ['roughness', 0.75],
    ['noise_seed', 1234567n],
    ['z_index', 3n],
    ['straight', true],
  ]);
}

function territoryRecord(): GdDict {
  return new GdDict([
    ['position', vec(5, 6)],
    ['points', '[ Vector2( 7, 8 ), Vector2( 9.5, 10 ) ]'],
    ['smoothing', 0.5],
    ['color', col(0.2, 0.3, 0.4, 1)],
    ['opacity', 0.66],
    ['style', 'synth/border'],
    ['width', 4.5],
    ['z_index', -2n],
  ]);
}

function fullSymbol(): GdDict {
  return new GdDict([
    ['texture', 'synth/tree'],
    ['position', vec(11, 22)],
    ['rotation', 0.25],
    ['scale', vec(1.5, 2.5)],
    ['z_index', 1n],
    ['offset', vec(3, 4)],
    ['radius', 12.5],
    ['type', 'tree'],
    ['mirror', false],
    ['sample', col(0.5, 0.5, 0.5, 1)],
    ['custom_colors', [col(1, 0, 0, 1), col(0, 1, 0, 1), col(0, 0, 1, 1)]],
    ['custom_color_mode', 2n],
  ]);
}

function bareSymbol(): GdDict {
  return new GdDict([
    ['texture', new GdObject('ImageTexture', [['width', 4n], ['height', 8n]])],
    ['position', vec(33, 44)],
    ['rotation', 0.75],
    ['scale', vec(3.5, 4.5)],
    ['z_index', -1n],
    ['offset', vec(7, 8)],
    ['radius', 24.5],
    ['type', 'rock'],
    ['mirror', true],
    ['sample', null],
    ['custom_colors', null],
    ['custom_color_mode', null],
  ]);
}

function intGlowLabel(): GdDict {
  return new GdDict([
    ['position', vec(50, 60)],
    ['rotation', 12.5],
    ['text', 'Northmill'],
    ['font', 'SynthSerif'],
    ['size', 14n],
    ['color', col(0, 0, 0, 1)],
    ['outline_size', 1n],
    ['outline_color', col(1, 1, 1, 1)],
    ['glow_size', 2n],
    ['glow_color', col(1, 1, 0, 1)],
    ['align', 1n],
    ['curve', 0.125],
    ['extra_spacing_char', 3n],
    ['z_index', 0n],
  ]);
}

function realGlowLabel(): GdDict {
  return new GdDict([
    ['position', vec(70, 80)],
    ['rotation', -12.5],
    ['text', 'Southford'],
    ['font', 'SynthSans'],
    ['size', 18n],
    ['color', col(1, 1, 1, 1)],
    ['outline_size', 2n],
    ['outline_color', col(0, 0, 0, 1)],
    ['glow_size', 1.5],
    ['glow_color', col(0, 1, 1, 1)],
    ['align', 1n],
    ['curve', -0.125],
    ['extra_spacing_char', 0n],
    ['z_index', 0n],
  ]);
}

// Small VALID v15 map covering every record kind. Wire NIL appears as
// `trace` (and optionally `grid`/`scale`); the null Object appears as an
// Image `script` prop. Card 0.4c reuses this builder.
export function makeSyntheticRoot(options: WdSyntheticOptions = {}): GdDict {
  return new GdDict([
    ['version', 15n],
    ['map_width', 320.5],
    ['map_height', 200.25],
    ['water_level', 0.33],
    ['water_flip_x', true],
    ['water_flip_y', false],
    ['water_offset', vec(9, 10)],
    ['water_stain', 0.11],
    ['windroses', []],
    ['theme', themeRecord()],
    ['layers', layersRecord()],
    ['paths', [pathRecord()]],
    ['territories', new GdDict([['territories', [territoryRecord()]]])],
    ['symbols', [fullSymbol(), bareSymbol()]],
    ['labels', [intGlowLabel(), realGlowLabel()]],
    ['sharpen_labels', true],
    ['mask', tinyRaster(1, 2)],
    ['ground', tinyRaster(17, 0)],
    ['water_tint', tinyRaster(33, 4)],
    ['trace', null],
    ['grid', options.gridNull ? null : gridRecord()],
    ['frame', frameRecord()],
    ['scale', options.scaleNull ? null : scaleRecord()],
    ['boxes', []],
    ['load_default_symbols', true],
    ['load_default_not_symbols', false],
    ['included_default_packs', ['PackA', 'PackB', 'PackC']],
    ['included_packs', ['PackD']],
  ]);
}
