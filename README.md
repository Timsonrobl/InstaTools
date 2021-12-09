# InstaTools

User script for making certain social networks less time and attention consuming by providing a bird's-eye view of content and bypassing click-through attention-keeping techniques.\
The philosophy of this script is to make **no DOM changes** or any activity detectable by telemetry.

## Contents
  - [Installation](#installation)
  - [Usage](#usage)
    - [Stories and Highlights](#stories-and-highlights)
    - [Photos and videos](#photos-and-videos)

## Installation
1. This script requires Greasemonkey-compatible browser extension to work:
   - [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) for Google Chrome\
or
   - [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/) for Mozilla Firefox

2. After you've installed one of the above extensions you can just click [this link](https://github.com/Timsonrobl/InstaTools/raw/master/InstaTools.user.js) to install the user script directly from the master branch and enable automatic updates.

## Usage
Currently, InstaTools provides the following features:

### Stories and Highlights
- Click on any user's small avatar in the stories tray, feed, or post to open the user's current stories in a new tab (auto-closes tab if stories are empty, **does not** mark stories as viewed).
- Click on the empty space in the stories tray to open the Stories Timeline viewer where you can observe the contents of the stories tray (150 followed users with active stories selected by ig algorithms) in reverse chronological order from latest to oldest.
- On user profile pages:
  - You can click avatar to view a full-size version of it if it exists.
  - Click on the user name to view current stories.
  - Click on any highlights to view their contents in reverse chronological order paginated by 15 stories (**does not** mark highlight as viewed).

All stories viewers will highlight clickable areas (currently excepting location tags) with red rectangles including hidden (invisible or out of viewport bounds).

### Photos and videos

- Click on any image in feed or post to open the max resolution version of it in a new tab (middle click for background tab)
- Middle-click on any video/reel to open max resolution version of it in a new tab player with playback controls and save as file option.