import Link from "next/link";

const footerCategories = ["World", "Politics", "Technology", "Business", "Sports", "Health", "Opinion"];

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <h2>World News Simply</h2>
          <p>Clear, fast briefings from around the world, written for everyday reading.</p>
        </div>
        <div>
          <h3>Categories</h3>
          {footerCategories.map((category) => (
            <Link key={category} href={`/?category=${category}`}>
              {category}
            </Link>
          ))}
        </div>
        <div>
          <h3>Follow Us</h3>
          <div className="social-links">
            <a href="https://twitter.com" aria-label="Twitter">T</a>
            <a href="https://facebook.com" aria-label="Facebook">F</a>
            <a href="https://instagram.com" aria-label="Instagram">I</a>
            <a href="/rss" aria-label="RSS">RSS</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
