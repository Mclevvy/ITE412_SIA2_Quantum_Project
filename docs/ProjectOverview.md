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


## High-Level System Overview

  1. Major Modules/Subsystems
     Authentication Module – Handles winemaker/staff login and role-based access using Firebase Authentication, so only authorized people can view or update fermentation batches.
     Sensor Data Collection Module – Receives readings (temperature, pH, sugar/brix level) from IoT sensors attached to fermentation vats and writes them to the realtime database at set intervals.
     Fermentation Monitoring & Alerting Module – Continuously evaluates incoming readings against ideal fermentation ranges, logs any out-of-range events, and triggers alerts when a batch needs attention.
     Notification Module – Delivers real-time push notifications to the winemaker's device (via Firebase Cloud Messaging) whenever the monitoring module raises an alert.
     Dashboard Module – Presents a real-time and historical view of each batch's fermentation status to the winemaker and staff, and lets staff log manual batch updates.

3. External Systems/Interfaces
Firebase Realtime Database – stores live and historical sensor readings and alert logs.
Firebase Authentication – manages user accounts and login sessions.
Firebase Cloud Messaging (FCM) – third-party push notification service used to deliver alerts to the winemaker's phone.
IoT Sensor Hardware (ESP32/Arduino + temperature, pH, and brix/hydrometer sensors) – external data source feeding readings into the system via REST API calls.

4. Data Flow Summary
IoT sensors attached to each fermentation vat periodically send temperature, pH, and sugar/brix readings to the system's backend through REST calls. The Sensor Data Collection module stores each reading in the Fermentation Readings data store (Firebase Realtime Database). The Monitoring & Alerting module continuously reads the latest values, compares them against acceptable fermentation ranges, and — when a reading is out of range or a fermentation stage changes — logs the event to the Alerts Log and passes an alert trigger to the Notification module, which sends a push notification to the winemaker through FCM. Separately, the Authentication module verifies the winemaker's or staff's credentials against the User Accounts store before granting access to the Dashboard module, which pulls both current and historical readings and alerts to display batch status in real time, and accepts manual batch updates from staff.

