# Welcome to MCQ Studio

Double-click **MCQ Studio.exe** to start. It is a portable Windows app: no installation, Node.js, internet connection, or account is required. Alternatively, use **MCQ Studio Setup.exe** to install it with a desktop shortcut.

1. Click **Import question bank**, or drag a JSON file onto the app. **Example question bank.json** is included, and **Try the example** works directly inside the app.
2. Click **Start studying**. Choose practice or exam, how many questions to use, and optional shuffling.
3. In practice, choose an answer and press **Check answer** for immediate feedback. Checked answers are locked. You can skip questions and revisit them using the numbered navigator.
4. In an exam, you can change answers freely until submission. Set an optional limit of 1–1440 minutes. A timed exam continues counting down when the app is closed or the computer is asleep, and submits when the app next runs if time has expired.
5. Press **Submit quiz** or **Finish quiz** to view your score and explanations. Correct answers receive one point; wrong or unanswered questions receive zero, with no penalty. An unchecked practice selection still counts as your submitted answer.
6. Find past results under **History**. Retry the entire quiz or just missed questions; retries use the saved questions even if the original bank has changed or was removed.

Your progress is saved automatically. Return to the library or close the app at any time, then press **Resume** to continue. Only one unfinished session is kept. Starting another offers to resume the existing session or discard its unfinished progress.

For your own files, see **File format.md**, or open **File format & help** in the app and choose **Save example JSON**. Updating a bank with the same ID offers replacement; history is kept. Removing a bank also keeps saved results and the unfinished session.

## Your saved data

The portable and installed editions share `%APPDATA%\MCQ Studio`. Imported banks and progress stay on this computer. Copy that folder while the app is closed if you want a manual backup. Automatic writes maintain a previous good copy; if damaged saved data is detected, the app recovers from it when possible and keeps damaged files for recovery.

The portable executable stores its data in your Windows user profile, rather than beside the executable. Moving the executable does not move your progress. Uninstalling leaves your saved data intact.
