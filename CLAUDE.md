My tools use preference is in TOOLS.md.

I want to build an app to train reading musical notes.
One note (on th 5 lines) will be displayed on the screen, and the user should type on the correct button (create 7 buttons for do re mi fa sol la si do).
I want the interface to be available in french and english.
The user should be able to select clef de do or clef de sol or clef de fa.
The app should the record the time taken by the user to select the correct note. Also record the number of errors. Display a summary when the user hit the button "stop".
There should also be a "pause/resume" button.
Make the interface clean and modern.
Make sure the online app runs both on computer and smart phone.

The clef de do/sol/fa should appear on the 5 lines.
The app should be able to select the instrument (in particular, clef de do and clef de sol should have piano available).

Langauge should be at the very top right of the page; also add dark/light mode there.

Add a skip button.

Show the last 3 notes (shift to the left after submission).

In the menu, ther should be a slider to select how many pas notes to show (say 0-5).
Also add a quit button that goes back to the menu directly.

Now I want to add the ability of the user to say the note, and using voice recognition, have that as another way of input (so the user can either click or say).
First, let's plan this: what is a good model for voice recognition, knowing that there is only 7 possible things that the user can say.
Not that noise should be ignored, as well as if the user says "hello".
Add a microphone sensitivity treshold.
Allow user to click buttons while mic is on.

