import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, it } from 'vitest';
import { AuthCallbackPage } from './AuthCallbackPage';

function Destination() { const location = useLocation(); return <p>{location.pathname + location.search}</p>; }
it.each([
  ['/auth/callback?next=%2Fgroups%2Fabc', '/groups/abc'],
  ['/auth/callback?next=https://example.com', '/groups'],
  ['/auth/callback?intent=password&next=%2Fjoin', '/account/password?next=%2Fjoin'],
])('redirects %s safely', async (url, expected) => {
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/auth/callback" element={<AuthCallbackPage />} /><Route path="*" element={<Destination />} /></Routes></MemoryRouter>);
  expect(await screen.findByText(expected)).toBeInTheDocument();
});
