console.log("welcome to app.js");
showNotes();
//if user adds a note ,add it to a local storage

let addBtn = document.getElementById("addBtn");
addBtn.addEventListener("click", () => {
  let addTxt = document.getElementById("addTxt");
  let notes = localStorage.getItem("notes");
  if (notes == null) {
    notesobj = [];
  } else {
    notesobj = JSON.parse(notes);
  }
  notesobj.push(addTxt.value);
  localStorage.setItem("notes", JSON.stringify(notesobj));
  addTxt.value = "";
  // console.log(notesobj);
  showNotes();
});

//Function to show elements from local storage

function showNotes() {
  let notes = localStorage.getItem("notes");
  if (notes == null) {
    notesobj = [];
  } else {
    notesobj = JSON.parse(notes);
  }
  let html = "";
  notesobj.forEach(function (element, index) {
    html += `
        <div class="notecard my-2 mx-2 card" style="width: 18rem;">
                <div class="card-body">
                    <h5 class="card-title">Note ${index + 1}</h5>
                    <p class="card-text">${element}</p>
                    <button id=${index} onclick="deletenote(this.id)" class="btn btn-primary">Delete note</button>
                </div>
            </div>`;
  });
  let notesElm = document.getElementById("notes");
  if (notesobj.length != 0) {
    notesElm.innerHTML = html;
  } else {
    notesElm.innerHTML = `Nothing to show!  use"add a note" section above to add a note`;
  }
}

//Function to delete note
function deletenote(index) {
  // console.log('i am deleting',index);
  let notes = localStorage.getItem("notes");
  if (notes == null) {
    notesobj = [];
  } else {
    notesobj = JSON.parse(notes);
  }

  notesobj.splice(index, 1);
  localStorage.setItem("notes", JSON.stringify(notesobj));
  showNotes();
}

let search = document.getElementById("searchTxt");
search.addEventListener("input", function () {
  let inputval = search.value.toLowerCase();
  // console.log ('input event search ', inputval );
  let notecards = document.getElementsByClassName("notecard");
  Array.from(notecards).forEach(function (element) {
    let cardtxt = element.getElementsByTagName("p")[0].innerText;
    if (cardtxt.includes(inputval)) {
      element.style.display = "block";
    } else {
      element.style.display = "none";
    }

    // console.log(cardtxt)
  });
});
