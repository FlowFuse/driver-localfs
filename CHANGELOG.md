#### 1.13.3: Release

 - Bump to v1.13.3 release @hardillb

#### 1.13.0: Release

 - Pin reusable workflows to v0.1.0 (#100) @ppawlowski
 - Update ff references in package.json (#99) @knolleary
 - Change repo references in workflows after github org rename (#97) @ppawlowski

#### 1.12.0: Release

 - Publish nightly package to npmjs (#96) @ppawlowski

#### 1.11.1: Release

 - Pin reusable workflow to commit SHA (#93) @ppawlowski
 - Disable scheduled package build (#92) @ppawlowski
 - Update to @flowforge/nr-launcher@1.11.1

#### 1.11.0: Release

 - Enable flowforge package build dispatcher after package publish (#90) @ppawlowski
 - Bump word-wrap from 1.2.3 to 1.2.5 (#89) @app/dependabot
 - FIX: Allow publish only when changes are pushed to `main` branch (#88) @ppawlowski
 - Introduce publish pipeline (#85) @ppawlowski

#### 1.10.0: Release


#### 1.9.2: Release

 - Update to @flowforge/nr-launcher@01.9.2

#### 1.9.0: Release

 - Add package-lock.json (#82) @Pezmc

#### 1.8.0: Release


#### 1.7.0: Release


#### 1.6.0: Release


#### 1.5.0: Release


#### 1.4.0: Release


#### 1.3.0: Release


#### 1.2.0: Release


#### 1.1.0: Release

 - Change default start port (#72) @hardillb
 - Fix detection of default stack (#71) @knolleary
 - Add getDefaultStackProperties function (#70) @hardillb
 - Add flags to permit TCP/UDP inbound connections (#69) @Steve-Mcl

#### 1.0.0: Release

 - Update eslint and add default build action (#67) @knolleary
 - Revert 64 (#66) @hardillb
 - Install theme and project nodes into userDir (#64) @hardillb

#### 0.10.0: Release


#### 0.9.0: Release

 - Prevent localfs crash when deleting project (#60) @Steve-Mcl

#### 0.8.0: Release

 - Add licenseType to launcher env (#58) @knolleary
 - Add env var FORGE_TEAM_ID (#57) @Steve-Mcl
 - Add FORGE_BROKER_* credentials to launcher env (#54) @knolleary

#### 0.7.0: Release


#### 0.6.0: Release

 - Map FlowForge logout to nodered auth/revoke (#48) @Steve-Mcl
 - Handle actions on deleted project (#49) @knolleary
 - Update dependencies (#50) @knolleary
 - Pass credentialSecret to env (supports auto gen credential secret PRs) (#47) @Steve-Mcl
 - Add description to stack memory value (#46) @hardillb
 - Make sure DB has right values for port + URL (#45) @hardillb

#### 0.5.0: Release

 - Modify nodered stack property regex to support beta releases (#43) @knolleary

#### 0.4.0: Release

 - Move setting project URL to before launcher started (#39) @hardillb
 - Update localfs to new driver api (#37) @knolleary
 - Update project automation (#38) @knolleary

#### 0.3.0: Release

 - Stop driver setting baseURL/forgeURL (#35) @knolleary
 - Add basic stack support (#30) @knolleary
 - Fix port allocation problem (main) (#32) @hardillb
 - Stop opening cmd windows (#29) @hardillb
 - Update package-lock.json (#28) @hardillb
 - Automate npm publish on release (#27) @hardillb

#### 0.2.0: Release

 - Add shutdown hook (#24) @hardillb
 - Add lint rules (#22) @hardillb
 - Add project workflow automation (#20) @knolleary
