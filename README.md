AutoCADPlugin - Kakao Static Map from AutoCAD selection

Overview
- Visual Studio 2022, .NET Framework 4.8
- AutoCAD 2024 managed API (acdbmgd.dll, acmgd.dll)
- Command: ShowMapFromSelection

Build/Setup
1. Create a Class Library (.NET Framework) project targeting .NET Framework 4.8 in Visual Studio 2022.
2. Add references to AutoCAD managed assemblies (acdbmgd.dll, acmgd.dll) from your AutoCAD 2024 installation Managed folder.
3. Set Output path and copy resulting DLL to AutoCAD's support folder or load via NETLOAD.
4. Provide Kakao REST API key in code or via environment variable.

Usage
- In AutoCAD, run: ShowMapFromSelection
- Select objects (Polyline selection or Window selection). The plugin computes bounding box, converts to lat/lon (simple stub), calls Kakao Static Map API, and shows map in a WinForms dialog.
