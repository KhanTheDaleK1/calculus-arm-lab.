# Codex Documentation: CalculusArm Dynamics Lab

This document provides technical details about the `CalculusArm Dynamics Lab` project for developers.

## Project Structure

The project is structured as follows:

*   `.git/`: Git version control files.
*   `.github/`: CI/CD workflows for deploying to GitHub Pages.
*   `arduino/`: Source code for the Arduino firmware for the robotic arm and car.
*   `golden_state_backup/`: A snapshot of the project.
*   `web/`: The static web application that serves as the control interface.
*   `GEMINI.md`: Gemini interaction guide.
*   `README.md`: Detailed project documentation.
*   `robots.txt`: Search engine indexing rules.
*   `sitemap.xml`: Sitemap for crawlers.
*   `test_motor.py`: Python script for testing motors.

## Key Files

*   `web/index.html`: The main entry point for the web interface.
*   `arduino/CalculusArmFirmware/CalculusArmFirmware.ino`: Firmware for the robotic arm.
*   `arduino/BlackCarFirmware/BlackCarFirmware.ino`: Firmware for the robot car.
*   `README.md`: The main documentation file.

## Development Setup

The project is a static web app that communicates with an Arduino. The frontend is built with vanilla HTML, CSS, and JavaScript. The firmware is written in C++ for the Arduino. The `README.md` contains detailed hardware and software setup instructions.

*This document is intended for developers and contributors.*
