import { assertRequiredCaps, FORMAT_NAMES, probeCaps, type CapsReport } from '../../src/renderer/render/gl/caps.ts';
import { createGlContext } from '../../src/renderer/render/gl/context.ts';
import { openContext } from '../../src/renderer/render/gl/index.ts';
import { assertEqual, assertThrowsGl, assertTrue, freshCanvas, type GpuCase } from './index.ts';

async function capsRealGpu(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const report = probeCaps(context.gl);
    if (typeof report.unmaskedRenderer !== 'string' || report.unmaskedRenderer.length === 0) {
      throw new Error('unmaskedRenderer is empty');
    }
    if (/swiftshader|llvmpipe|software|basic render/i.test(report.unmaskedRenderer)) {
      throw new Error(`software renderer detected: ${report.unmaskedRenderer}`);
    }
    if (!(report.maxTextureSize >= 16384)) {
      throw new Error(`maxTextureSize too small: ${report.maxTextureSize}`);
    }
    const sorted = [...report.extensions].sort();
    assertEqual(JSON.stringify(report.extensions), JSON.stringify(sorted), 'extensions sorted');
    assertTrue(report.extensions.includes('EXT_color_buffer_float'), 'EXT_color_buffer_float present');
    assertEqual(report.formats.length, 8, 'eight format reports');
    // The report is JSON-serialisable: a round trip leaves it unchanged.
    assertEqual(
      JSON.stringify(JSON.parse(JSON.stringify(report))),
      JSON.stringify(report),
      'caps JSON round trip',
    );
  } finally {
    context.dispose();
  }
}

async function capsRequiredFormats(): Promise<void> {
  const canvas = freshCanvas();
  const context = createGlContext(canvas);
  try {
    const report = probeCaps(context.gl);
    for (const name of FORMAT_NAMES) {
      const found = report.formats.find((f) => f.name === name);
      if (!found) throw new Error(`no report for ${name}`);
      assertTrue(found.texture, `${name} texture`);
      assertTrue(found.renderable, `${name} renderable`);
      assertTrue(found.roundTrip, `${name} roundTrip`);
    }
    // The real report passes the gate.
    assertRequiredCaps(report);
    // A doctored report names EVERY missing item in one message.
    const doctored: CapsReport = {
      ...report,
      maxTextureSize: 1024,
      formats: report.formats.map((f) =>
        f.name === 'R16F' || f.name === 'RG16UI' ? { ...f, renderable: false, roundTrip: false } : f,
      ),
    };
    const failure = assertThrowsGl('CAPABILITY', () => assertRequiredCaps(doctored), 'doctored report');
    for (const needle of ['R16F', 'RG16UI', '1024']) {
      if (!failure.message.includes(needle)) throw new Error(`CAPABILITY message must name ${needle}: ${failure.message}`);
    }

    // openContext wires the whole foundation: real success on the GPU, and a
    // failed gate disposes the context it just created. The listener
    // add/remove counts prove the disposal happened.
    const opened = openContext(freshCanvas());
    try {
      assertEqual(opened.caps.formats.length, 8, 'openContext eight format reports');
      assertEqual(opened.context.isLost(), false, 'openContext context live');
    } finally {
      opened.context.dispose();
    }
    const backingCanvas = freshCanvas();
    const backingGl = backingCanvas.getContext('webgl2');
    if (backingGl === null) throw new Error('could not create a WebGL2 context for the openContext probe');
    const added: string[] = [];
    const removed: string[] = [];
    const floatless = new Proxy(backingGl, {
      get(target: WebGL2RenderingContext, property: string | symbol): unknown {
        if (property === 'getExtension') {
          return (name: string): unknown =>
            name === 'EXT_color_buffer_float' ? null : target.getExtension(name);
        }
        const value: unknown = Reflect.get(target, property);
        if (typeof value === 'function') return (value as (...args: never[]) => unknown).bind(target);
        return value;
      },
    });
    const failingCanvas = {
      getContext: (): unknown => floatless,
      addEventListener: (type: string): void => {
        added.push(type);
      },
      removeEventListener: (type: string): void => {
        removed.push(type);
      },
    };
    const openFailure = assertThrowsGl(
      'CAPABILITY',
      () => openContext(failingCanvas as unknown as HTMLCanvasElement),
      'openContext capability failure',
    );
    assertTrue(openFailure.message.includes('R16F'), `openContext failure names float formats: ${openFailure.message}`);
    assertEqual(
      JSON.stringify(added),
      JSON.stringify(['webglcontextlost', 'webglcontextrestored']),
      'openContext attached listeners',
    );
    assertEqual(
      JSON.stringify(removed),
      JSON.stringify(['webglcontextlost', 'webglcontextrestored']),
      'failed openContext removed listeners',
    );
  } finally {
    context.dispose();
  }
}

export const capsCases: readonly GpuCase[] = [
  { name: 'caps: real GPU', run: capsRealGpu },
  { name: 'caps: required formats', run: capsRequiredFormats },
];
