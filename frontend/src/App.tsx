import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ToastViewport } from "./components/ui";
import { Browse } from "./pages/Browse";
import { ListingPage } from "./pages/Listing";
import { Sell } from "./pages/Sell";
import { Offers } from "./pages/Offers";
import { Orders } from "./pages/Orders";
import { Admin } from "./pages/Admin";
import { Diagnostics } from "./pages/Diagnostics";
import { NotFound } from "./pages/NotFound";

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Browse />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/sell" element={<Sell />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/check" element={<Diagnostics />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <ToastViewport />
    </>
  );
}
