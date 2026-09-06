import { redirect } from 'next/navigation';

// The site root. This used to be "My Shelf" — a second, separate page listing
// the user's sets. Its set cards, filters and New Upload button now live in the
// "Sets in Progress" section of /home, so the shelf had nothing left of its own.
//
// The route itself has to stay: sports-collective.com resolves here, and the
// "← My Shelf" back-links scattered across older pages still point at "/".
// Deleting the file would 404 the domain root, so it redirects instead.
export default function RootPage() {
  redirect('/home');
}
