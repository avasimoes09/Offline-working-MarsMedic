const form = document.querySelector('#master-password-form');
const password = document.querySelector('#master-password');
const confirmation = document.querySelector('#master-password-confirmation');
const confirmField = document.querySelector('#confirmation-field');
const error = document.querySelector('#error-message');
const cancel = document.querySelector('#cancel-button');
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

if (mode === 'create') {
  document.querySelector('#title').textContent = 'Protect this USB copy';
  document.querySelector('#description').textContent = 'Create a separate master password to encrypt patient data on this drive. You will need it each time M. I. A. starts.';
  confirmField.hidden = false;
  password.autocomplete = 'new-password';
  confirmation.autocomplete = 'new-password';
  password.minLength = 12;
  confirmation.disabled = false;
} else {
  document.querySelector('#title').textContent = 'Unlock patient data';
  document.querySelector('#description').textContent = 'Enter the portable master password to unlock this drive’s encrypted patient data.';
  password.autocomplete = 'current-password';
  confirmation.disabled = true;
  confirmation.required = false;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  error.textContent = '';
  window.miaMasterPassword.submit(password.value, mode === 'create' ? confirmation.value : '');
});
cancel.addEventListener('click', () => window.miaMasterPassword.cancel());
window.miaMasterPassword.onError((message) => {
  error.textContent = message;
  password.value = '';
  confirmation.value = '';
  password.focus();
});
password.focus();
