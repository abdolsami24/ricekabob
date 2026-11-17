// Privacy policy for Madinah Market (ricekabob.com). Required by Google
// for the "Sign in with Google" consent screen, and linked from the site.

export const metadata = { title: "Privacy Policy — Madinah Market" };

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "2rem 1.25rem 4rem",
        lineHeight: 1.65,
      }}
    >
      <p>
        <a href="/">← Back to menu</a>
      </p>
      <h1>Privacy Policy — Madinah Market</h1>
      <p>
        <em>Last updated: November 16, 2026</em>
      </p>
      <p>
        Madinah Market ("we", "us") operates the website ricekabob.com for
        online food ordering (pickup and delivery). This page explains what
        information we collect and how we use it.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Order information:</strong> your name, phone number,
          delivery address (for delivery orders), and the items you order.
        </li>
        <li>
          <strong>Account information (optional):</strong> if you create an
          account or sign in with Google, we store your email address and,
          if you save them, your name, phone number, and default delivery
          address, plus your order history and loyalty points.
        </li>
        <li>
          <strong>Payment information:</strong> card payments are processed
          by Stripe. We do not see or store your full card number.
        </li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>To prepare and deliver your order.</li>
        <li>
          To contact you about your order (for example, if there is a
          question or a delay).
        </li>
        <li>
          To run your account, order history, and loyalty points if you
          sign in.
        </li>
        <li>
          For delivery orders, your address and phone number are shared
          with our delivery partner (Shipday) only so the driver can reach
          you.
        </li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your personal information.</li>
        <li>We do not use your information for advertising by third parties.</li>
      </ul>

      <h2>Sign in with Google</h2>
      <p>
        If you choose "Sign in with Google", Google shares your name and
        email address with us so we can create and secure your account. We
        do not receive your Google password.
      </p>

      <h2>Your choices</h2>
      <p>
        You can order as a guest without an account. To see, correct, or
        delete the information we hold about you, contact us and we will
        help.
      </p>

      <h2>Contact</h2>
      <p>
        Madinah Market
        <br />
        3126 S Parker Rd, Aurora, CO 80014
        <br />
        Phone: 720-763-0786
        <br />
        Email: Abdolsami@yahoo.com
      </p>
    </main>
  );
}
