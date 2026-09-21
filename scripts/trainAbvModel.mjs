import fs from 'node:fs';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs-node';

const outDir = path.resolve('public/model_master');
fs.mkdirSync(outDir, { recursive: true });

function generateSyntheticData(samples = 2400) {
  const xs = [];
  const ys = [];

  for (let i = 0; i < samples; i += 1) {
    const days = 2 + Math.random() * 18;
    const temp = 18 + Math.random() * 16;
    const ph = 2.8 + Math.random() * 1.4;
    const pressure = 2 + Math.random() * 12;

    const yeastFactor = 0.38 + Math.random() * 0.22;
    const sugarEffect = (22 - (0.4 * temp) + (0.6 * pressure) + (0.7 * days)) / 8;
    const acidShift = (4.2 - ph) * 0.7;
    const abv = Math.max(0.3, Math.min(18.5, 0.65 + (0.42 * days) + (0.25 * pressure) + (0.18 * yeastFactor * (26 - ph)) - (0.12 * temp / 10) + acidShift * 0.4 + sugarEffect * 0.08));

    xs.push([days, temp, ph, pressure]);
    ys.push([abv]);
  }

  return { xs: tf.tensor2d(xs), ys: tf.tensor2d(ys) };
}

async function main() {
  const { xs, ys } = generateSyntheticData();

  const model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [4], units: 64, activation: 'relu' }),
      tf.layers.dense({ units: 64, activation: 'relu' }),
      tf.layers.dense({ units: 32, activation: 'relu' }),
      tf.layers.dense({ units: 1, activation: 'linear' }),
    ],
  });

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
    metrics: ['mae'],
  });

  await model.fit(xs, ys, {
    epochs: 140,
    batchSize: 64,
    validationSplit: 0.15,
    shuffle: true,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        if (epoch % 20 === 0 || epoch === 139) {
          console.log(`Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)}, mae=${logs.mae.toFixed(4)}`);
        }
      },
    },
  });

  const testData = tf.tensor2d([
    [3, 25, 3.5, 5],
    [7, 28, 3.8, 7],
    [12, 30, 3.2, 9],
    [16, 27, 3.1, 11],
  ]);

  const predictions = model.predict(testData);
  const values = await predictions.data();
  console.log('Example predictions:', Array.from(values).map((v) => Number(v.toFixed(2))));

  const modelJson = await model.save(`file://${outDir}`);
  const params = {
    feature_columns: ['days_since_start', 'summary_average_temp', 'summary_average_ph', 'summary_average_pressure_psi'],
    impute_medians: [3.0, 24.0, 3.5, 6.0],
    scale_mean: [7.0, 24.0, 3.6, 6.0],
    scale_scale: [5.0, 8.0, 0.7, 5.0],
    coef: [0.5, 0.25, -0.38, 0.18],
    intercept: 1.2,
    brix_to_abv_factor: 0.59,
    og_brix_assumed: 22,
    n_training_samples: 2400,
    trained_at: new Date().toISOString(),
    model_source: 'synthetic fermentation batches',
    calibration_target_abv: 12,
    calibration_reference: [3.3, 24, 8, 5],
  };

  fs.writeFileSync(path.join(outDir, 'abvModelParams.json'), JSON.stringify(params, null, 2));
  console.log(`Model and params saved to ${outDir}`);
  console.log('Model JSON location:', modelJson);

  xs.dispose();
  ys.dispose();
  testData.dispose();
  predictions.dispose();
}

try {
  await main();
} catch (error) {
  console.error('ABV training failed:', error);
  process.exitCode = 1;
}
