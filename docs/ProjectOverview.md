# Project Overview

## 1. System Objectives
- **Problem:** Bignay wine fermentation is currently monitored manually — the winemaker checks temperature, sugar level, and pH by hand and by experience. This is time-consuming, inconsistent, and can let a batch spoil or ferment poorly if a problem isn't caught early.
- **Who benefits and how:** Small-scale bignay wine producers (represented by our stakeholder, Sir Jerry M. Casabar) benefit from real-time visibility into their fermentation batches, fewer spoiled batches, and more consistent wine quality. Down the line, this also benefits consumers of the finished wine through better, more reliable quality control.

## 2. Proposed Scope
- **Modules/systems to integrate:**
  - **Authentication (Auth)** – login/role management so only the winemaker and authorized staff can view or manage fermentation batches
  - **Realtime Database** – continuously stores sensor readings (temperature, pH, sugar/brix level) per batch
  - **Realtime Monitoring Dashboard** – visualizes current fermentation status and history for each batch
  - **Push Notifications** – alerts the winemaker when a reading goes outside the ideal range or when a fermentation stage changes
- **In-scope for Lab 1–3:** Auth, realtime database, monitoring dashboard, push notifications, and a simulated/basic sensor data feed
- **Out-of-scope (for now):** Payments/e-commerce, distributor/inventory management, multi-farm or multi-tenant support

## 3. Stakeholders
- **Sir Jerry M. Casabar — Local Bignay Wine Maker (real):** Needs a simple, real-time way to see how each batch is fermenting so he can catch problems early and keep quality consistent across batches.
- **Municipal Agriculture Office, LGU (role-played):** Supports local wine microenterprises and is interested in data that could help with food-safety compliance and quality-assurance reporting for small producers like Sir Jerry.

## 4. Tools & Technologies
- **Languages/Frameworks:** Node.js + Express (backend), React (web dashboard), Python (for sensor/IoT scripting if using Raspberry Pi/Arduino)
- **Realtime Database, Auth, Notifications:** Firebase Realtime Database (or Firestore), Firebase Authentication, Firebase Cloud Messaging (FCM)
- **Sensor/IoT layer (optional hardware):** ESP32/Arduino with a temperature/humidity sensor, pH sensor, and hydrometer/refractometer for sugar content
- **Integration approach:** REST APIs for sensor-to-backend communication; Firebase SDKs (WebSocket-based) for realtime sync to the dashboard; webhooks to trigger push notifications when a reading crosses a threshold
- **Repos/Services:** GitHub (this repository)
- **Testing tools:** Postman (API testing), Jest (unit tests)