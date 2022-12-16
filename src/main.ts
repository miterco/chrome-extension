import * as c from './constants';
import bridge, { MessageType } from './bridge';
import * as util from './util';
import env from "./derived/env";

interface EventData {
  eventIdContext?: string;
}

const UIStates = c.UIStates;

let uiState = UIStates.Normal;
let currentChipContainer = null;
let nearbyChipCount = -1;
let prevNearbyChipCount = -1;
let chipObserver = null;
let skipAnalyticsDuringInitialLoad = true;

let titleInput = null;
let saveButton = null;
let saveActionIsSave = false;
let staticPopupBelowTitleRow = null;
//let goalBlock = null;

let eventData: EventData = {};


// Lifecycle

const changeUIState = (newState) => {
  util.log(`Change UI State: ${uiState} -> ${newState}`);
  if (newState !== uiState) {
    const oldState = uiState;
    uiState = newState;
    switch (uiState) {

      case UIStates.PopupEdit:
        if (!document.getElementById("miter_modalRow")) {
          editPopupDidAppear();
        } else {
          util.log("Possible bug: registered showing the modal edit when it's already present.");
        }
        break;

      case UIStates.PopupStatic:
        staticPopupDidAppearOrRefresh();
        break;

      case UIStates.PageEdit:
      case UIStates.PageCreate:
        editPageDidAppear();
        break;

      case UIStates.Normal:
        if (oldState === UIStates.PopupEdit) {
          editPopupDidDisappear();
        } else if (oldState === UIStates.PopupStatic) {
          bridge.sendMessage(MessageType.StaticPopupClosed, eventData);
        } else if (oldState === UIStates.PageEdit || oldState === UIStates.PageCreate) {
          editPageDidDisappear(oldState === UIStates.PageEdit);
        }
        break;
    }
  } else if (newState === UIStates.PopupStatic) {
    // State can change from PopupStatic to PopupStatic because the dialog keeps getting re-created.
    // TODO feels like a bit of a hack
    staticPopupDidAppearOrRefresh();
  }
};



const makeMiterBelowTitleRow = isEditPage => {
  const bc = bridge.config;

  // Using a span rather than a div prevents GCal from recycling this in the static popup
  const rowElement = document.createElement('span');

  rowElement.className = `${bc.sel.MiterBelowTitleRow} ${isEditPage ? 'Page' : 'Popup'}`;
  rowElement.innerHTML = bc.content.BelowTitleInputRowInner;

  const btn = rowElement.querySelector(bc.sel.MiterStartButton);
  if (btn) btn.addEventListener('click', handleOpenMeeting);

  return rowElement;
};

const handleSaveAction = e => {
  if (e.constructor.name === "MouseEvent" || e.key === "Enter") {
    util.log('Registering a save action');
    saveActionIsSave = true;
    window.setTimeout(() => { saveActionIsSave = false; }, 1500); // In case somehow the event didn't result in a submit
  }
};




const editPopupDidAppear = () => {
  const bc = bridge.config;
  eventData = {};

  // Replace "Add a title" placeholder with our own
  const titlePlaceholder = titleInput.nextElementSibling;
  titlePlaceholder.innerHTML = bc.content.SubjectPrompt;

  // TODO given we're now only modifying the title placeholder, the rest of this function
  // may be unnecessary. Evaluate after Sept 2021 if not before.

  // Start watching event chips in the current day (grid cell) in preparation for determining whether a close action is a cancel or a create.
  const allEventChips = document.querySelectorAll(bc.sel.EventChip);
  let currentEventChip = null;
  allEventChips.forEach(chip => {
    if (chip.getAttribute('data-eventid').length < 32) {
      // Chips for new events have a much shorter data-eventid string
      currentEventChip = chip;
    }
  });
  if (currentEventChip) {
    currentChipContainer = currentEventChip.parentElement;
    chipObserver = util.createChildObserver(currentChipContainer, () => {
      countEventChips();
    });
    countEventChips(); // Get initial count, since in most cases there won't be intervening mutations.
  } else {
    util.error("We believe we're editing a new event in the popup without a chip to represent it.");
  }

  bridge.sendMessage(MessageType.CreatePopupOpened, eventData);
};


const editPopupDidDisappear = () => {
  chipObserver?.disconnect();
  chipObserver = null;

  const chipCountBeforeLastMutation = prevNearbyChipCount;
  const chipCountAfterLastMutation = nearbyChipCount;
  countEventChips();
  const currentChipCount = nearbyChipCount;

  if (currentChipCount === chipCountAfterLastMutation) {
    // We expect this always to be true: between the last mutation and registering the dialog closed, no change.
    if (chipCountBeforeLastMutation === chipCountAfterLastMutation) {
      bridge.sendMessage(MessageType.CreatePopupSaved, eventData);
    } else {
      bridge.sendMessage(MessageType.CreatePopupCanceled, eventData);
    }
  } else {
    // Somehow, between the last recorded mutation and now, the chip count changed, which means GCal is doing something we didn't expect.
    util.error("Current chip count doesn't match chip count after last mutation.");
  }
};

const staticPopupDidAppearOrRefresh = () => {
  const bc = bridge.config;

  // Some mutations that trigger this relate to changes _around_ the popup rather than
  // to the popup. So let's see if we've already modified this one.
  const popup = document.querySelector(bc.sel.StaticPopup) || util.domWarning("Couldn't find static popup.");
  if (popup) {
    if (!popup.hasAttribute('data-miter-modified')) {
      util.log("Popup just appeared or has been updated to reflect a new event.");
      popup.setAttribute('data-miter-modified', 'true');
      eventData = { eventIdContext: popup.getAttribute(bc.sel.EventIdContextAttribute) };

      staticPopupBelowTitleRow = makeMiterBelowTitleRow(false);
      insertStaticPopupBelowTitleRow();

      /*
        // Keeping this code commented-out despite removing the goal nudge so we can reflect
        // existing goals (or lack thereof) in static popup. Remove if unused after Sept 2021.
        // If you re-enable, make sure you also re-enable the section that keeps the goal block
        // in the popup when the popup rearranges itself—currently lines 221-226 and the block
        // containing the comment, "Goal block has been kicked out".
        
        // Show goal (or lack thereof) in static popup
        const goalContainer = document.createElement('span'); // Using a span rather than a div prevents GCal from recycling this.
        goalContainer.innerHTML = bc.content.StaticPopupGoalInner;

        // Add goal content
        goalContainer.querySelector(bc.sel.StaticGoalContainer).innerHTML = needToGetTheGoalFromSomewhereProbablyTheServer || bc.content.EmptyGoal;
        goalBlock = goalContainer;

        // Find insertion point and add
        insertStaticPopupGoalBlock();
      */

      bridge.sendMessage(MessageType.StaticPopupOpened, eventData);
    } else {
      /*
      * Google calendar occasionally rearranges the static popup even when there doesn't appear to be
      * any reason to. Anecdotally, it seems to have something to do with mousing around onto other
      * events in the view but I'm not sure about that. I surmise (but have not further investigated) 
      * that this has something to do with checking for changes on the server.
      * 
      * When this happens, any "foreign" content gets kicked out. Clockwise seems to have either solved
      * or sidestepped this, but it may be they're doing something similar to us. Again, I haven't
      * investigated.
      * 
      * One can watch for mutations to the dialog (as we do in the calling context for this function),
      * but mutations are only observed when something gets kicked out. That is, if you observe mutations
      * on the top level of the dialog content (`#xDetDlg`), you will *only* see them when foreign content
      * is present (e.g., turning off Clockwise prevents mutation notifications unless you insert something
      * else). Which means one has to watch the whole subtree, because parts of it are reconstructed completely
      * when this happens (i.e., watching the parent node of your node doesn't do the trick).
      * 
      * So, we're watching for notifications on the whole dialog subtree--the same node that we watch for when
      * the dialog is rebuilt because the user clicked on a new event. If it's a new event, we have another
      * pipeline for checking that. If it's this unexpected reconstruction, we know it because our node (which
      * we have a reference to) is no longer in the DOM tree.
      * 
      * When description-hiding is enabled, we also need to re-hide the description (at least sometimes).
      * 
      * One last crazy wrinkle. When GCal reconstitutes the dialog, it reuses the elements in it (mostly DIVs).
      * So if we insert a DIV as our content block and hold a reference to it as discussed, we end up with
      * a reference to some built-in GCal section that's already in the DOM--the DIV has been repurposed, 
      * mobile-list-style. The solution: don't use a DIV. By using a SPAN instead, we prevent GCal reuse.
      */
      util.log("Popup has rearranged itself.");

      if (!util.isElementInDom(staticPopupBelowTitleRow)) {
        // Start row has been kicked out
        insertStaticPopupBelowTitleRow();
      }

      /*
       * Remove after Sept 2021 if unused.
      if (!util.isElementInDom(goalBlock)) {
        // Goal block has been kicked out
        util.log("Reinserting goal block.");
        insertStaticPopupGoalBlock();
        hideRedundantStaticDescription();
      }
      */
    }
  }
};

/*
 * Keeping this commented-out despite removing the goal nudge so we can reflect
 * existing goals (or lack thereof) in static popup. Remove if unused after Sept 2021.
 *
const insertStaticPopupGoalBlock = () => {
  const innerHeading = document.querySelector(bridge.config.sel.StaticPopupHeadingInner); // This isn't interesting to us, just a good handle
  if (innerHeading) {
    const heading = innerHeading.parentElement;
    const headingContainer = heading.parentElement;
    headingContainer.insertBefore(goalBlock, heading.nextElementSibling);
  } else {
    util.error("Couldn't find innerHeading while trying to add content to static popup.");
  }
};
*/

const insertStaticPopupBelowTitleRow = () => {
  const innerHeading = document.querySelector(bridge.config.sel.StaticPopupHeadingInner); // This isn't interesting to us, just a good handle
  if (innerHeading) {
    const heading = innerHeading.parentElement;
    const headingContainer = heading.parentElement;
    headingContainer.insertBefore(staticPopupBelowTitleRow, heading.nextElementSibling);
  } else {
    util.error("Couldn't find innerHeading while trying to add content to static popup.");
  }
};

const editPageDidAppear = () => {
  const bc = bridge.config;
  eventData = {};

  // Grab the save button and attach some listeners so we can tell save from cancel
  saveButton = document.querySelector(bc.sel.EditPageSaveButton);
  if (saveButton) {
    saveButton.addEventListener('click', handleSaveAction);
    saveButton.addEventListener('keyup', handleSaveAction);
  } else {
    util.error("Edit page is visible but can't find the save button.");
  }

  // Modify title input placeholder
  const titlePlaceholder = document.querySelector(bc.sel.EditPageTitlePlaceholder) || util.domWarning("Couldn't find edit-page title placeholder.");
  if (titlePlaceholder) titlePlaceholder.innerHTML = bc.content.SubjectPrompt;

  // Add Miter stuff below title
  const titleRow = document.querySelector(bc.sel.EditPageTitleRow) || util.domWarning("Couldn't find edit-page title row.");
  if (titleRow) {
    const rowElement = makeMiterBelowTitleRow(true);
    rowElement.style.width = `${titleInput?.offsetWidth || 640}px`;
    titleRow.parentElement.insertBefore(rowElement, titleRow.nextElementSibling);
  }

  if (uiState === UIStates.PageEdit) {
    eventData.eventIdContext = document.querySelector(bc.sel.EditPage).getAttribute(bc.sel.EventIdContextAttribute);
    bridge.sendMessage(MessageType.EditPageOpened, eventData);
  } else {
    bridge.sendMessage(MessageType.CreatePageOpened, eventData);
  }
};

const editPageDidDisappear = wasEditPage => {
  util.log('Edit page did disappear.');
  if (saveActionIsSave) {
    util.log('Edit page disappeared and was a save.');
    bridge.sendMessage(wasEditPage ? MessageType.EditPageSaved : MessageType.CreatePageSaved, eventData);
  } else {
    bridge.sendMessage(wasEditPage ? MessageType.EditPageCanceled : MessageType.CreatePageCanceled, eventData);
  }
  saveActionIsSave = false;
};

const init = () => {
  const config = bridge.config;

  // Add CSS for our stuff
  const linkEl = document.createElement('link');
  linkEl.href = `${env.MVP_SERVER}/${config.cssFilename}`;
  linkEl.rel = "stylesheet";
  document.head.append(linkEl);

  const popupContainer = document.querySelector(config.sel.PopupContainer); // The element of which the popup details are a child when present.
  if (popupContainer) {
    // Observe the popup container for any mutations in its direct children, i.e., the popup appearing and disappearing.
    util.createChildObserver(popupContainer, () => {
      const popup = document.querySelector(config.sel.Popup);
      if (popup) {
        titleInput = popup.querySelector(config.sel.EditPopupTitleInput);
        if (titleInput) {
          // Popup contains a title input, so it's an edit popup.
          changeUIState(UIStates.PopupEdit);
        } else {
          // Popup is static
          // TODO do these observers need to be cleaned up?

          // Parts of popup are recreated as different events are clicked or randomly, so we need another mutation observer while the popup is open
          const popupParent = document.querySelector(bridge.config.sel.StaticPopup).parentElement;
          util.createChildObserver(popupParent, () => {
            changeUIState(UIStates.PopupStatic);
          }, true);

          changeUIState(UIStates.PopupStatic);
        }
      } else {
        // Popup has disappeared, but if we're already showing the edit page we shouldn't go back to normal.
        if (uiState !== UIStates.PageCreate && uiState !== UIStates.PageEdit) {
          changeUIState(UIStates.Normal);
        }
      }
    });
  } else {
    // Couldn't find dialog container
    util.error("Miter Calendar: Unable to locate dialog container.");
  }

  const editPageContainer = document.querySelector('.lYYbjc'); // The element of which the full-screen editor is a child when present.
  if (editPageContainer) {

    // Observe the container for any mutations to its direct children—i.e., the editor appearing and disappearing.
    util.createChildObserver(editPageContainer, () => {
      const page = document.querySelector(bridge.config.sel.EditPage);
      if (page) {
        // We're showing the full-page event editor, either new or existing. data-is-create attribute distinguishes.
        const page = document.querySelector('[data-is-create]');
        const isCreate = (page.getAttribute('data-is-create') === "true");
        changeUIState(isCreate ? UIStates.PageCreate : UIStates.PageEdit);
      } else {
        if (skipAnalyticsDuringInitialLoad) {
          // TODO hacky: This mutation fires once when things are first loading, so we skip tracking it.
          skipAnalyticsDuringInitialLoad = false;
        } else {
          changeUIState(UIStates.Normal);
        }
      }
    });
  } else {
    util.error("Unable to locate edit-page container.");
  }
};




// Other

const handleOpenMeeting = () => {
  bridge.sendMessage(MessageType.OpenMeeting, eventData);
};

const countEventChips = () => {
  prevNearbyChipCount = nearbyChipCount;
  nearbyChipCount = currentChipContainer.querySelectorAll('[data-eventchip]').length;
};

bridge.setInitCallback(init);
