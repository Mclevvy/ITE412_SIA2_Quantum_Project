import os
import random

import numpy as np
import tensorflow as tf
import tensorflowjs as tfjs

random.seed(42)
np.random.seed(42)
tf.random.set_seed(42)

# Synthetic fermentation dataset matching the app's existing 4-feature input:
# [avg_ph, avg_temp, avg_pressure_psi, days_since_start]
# Output target: ABV percentage

records = []

for day in range(1, 14):
    for _ in range(8):
        avg_ph = 4.8 - (day * 0.25) + random.uniform(-0.2, 0.2)
        avg_temp = 23.5 + (day * 0.35) + random.uniform(-1.0, 1.0)
        avg_pressure = 4 + (day * 0.9) + random.uniform(-0.8, 0.8)
        days_since_start = float(day)

        # Higher ABV is associated with lower pH, warmer temp, more pressure,
        # and a longer fermentation duration.
        abv = (
            1.2
            + max(0.0, (4.8 - avg_ph) * 1.1)
            + max(0.0, (avg_temp - 22.0) * 0.18)
            + max(0.0, (avg_pressure - 5.0) * 0.2)
            + (days_since_start * 0.45)
        )
        abv = min(16.0, max(1.0, abv * 0.8 + random.uniform(-0.5, 0.5)))

        records.append({
            "features": [
                round(max(2.0, min(5.0, avg_ph)), 3),
                round(max(18.0, min(35.0, avg_temp)), 3),
                round(max(0.0, min(20.0, avg_pressure)), 3),
                round(days_since_start, 3),
            ],
            "label": round(float(abv), 3),
        })

# Add a few explicit anchors so the model learns realistic early/late fermentation points.
anchors = [
    ([4.8, 23.0, 5.0, 1.0], 2.1),
    ([4.4, 24.0, 6.0, 2.0], 3.6),
    ([4.0, 25.0, 7.0, 3.0], 5.0),
    ([3.7, 25.7, 8.2, 5.0], 7.1),
    ([3.2, 26.2, 10.0, 7.0], 9.8),
    ([2.9, 26.5, 11.2, 9.0], 12.4),
    ([2.8, 27.0, 12.0, 11.0], 14.6),
    ([2.7, 27.2, 12.8, 13.0], 15.7),
]

for features, label in anchors:
    records.append({"features": features, "label": float(label)})

X = np.array([row["features"] for row in records], dtype=np.float32)
y = np.array([row["label"] for row in records], dtype=np.float32).reshape(-1, 1)

# Normalize for a stable fit.
feature_mean = X.mean(axis=0)
feature_std = X.std(axis=0)
feature_std = np.where(feature_std == 0, 1.0, feature_std)
X_norm = (X - feature_mean) / feature_std

model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(4,)),
    tf.keras.layers.Dense(32, activation="relu"),
    tf.keras.layers.Dense(16, activation="relu"),
    tf.keras.layers.Dense(1, activation="linear"),
])

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=0.01),
    loss="mse",
    metrics=["mae"],
)

history = model.fit(
    X_norm,
    y,
    epochs=500,
    batch_size=16,
    validation_split=0.15,
    verbose=0,
)

sample_input = np.array([
    [4.2, 25.0, 8.0, 5.0],
    [3.6, 25.8, 9.5, 7.0],
    [3.1, 26.3, 10.5, 9.0],
], dtype=np.float32)
print("Sample predictions:")
print(model.predict((sample_input - feature_mean) / feature_std, verbose=0).flatten())

output_dir = os.path.join(os.getcwd(), "public", "model_master")
os.makedirs(output_dir, exist_ok=True)

# Export as TensorFlow.js model files expected by tf.loadLayersModel('/model_master/model.json').
# This needs the tensorflowjs package, which is installed via:
#   py -3 -m pip install tensorflow tensorflowjs
try:
    tfjs.converters.save_keras_model(model, output_dir)
    print(f"TensorFlow.js model exported to: {output_dir}")
except Exception as exc:  # pragma: no cover
    print("TensorFlow.js export failed:", exc)
    print("Falling back to Keras save format.")
    model.save(output_dir)
    print(f"Keras model exported to: {output_dir}")

print("Final training loss:", history.history["loss"][-1])
print("Final validation loss:", history.history["val_loss"][-1])
