"""ZeroTouch Local Gesture Recognition Engine (motor_local).

6-layer modular architecture:
1. capture.py       - Webcam video capture and cleanup (OpenCV)
2. detector.py      - Hand landmark detection (MediaPipe Hands)
3. interpreter.py   - Pure state machine producing logical gesture events
4. action_engine.py - Mode enforcement (OBSERVATION vs CONTROL), safety, cooldowns
5. os_adapter.py    - Operating system input adapter (pynput + mock adapter)
6. config.py        - Calibration and configuration validation/mapping
"""
