import Link from "next/link";

const footerCategories = ["World", "Politics", "Technology", "Business", "Sports", "Health", "Opinion"];
const trustLinks = [
  ["About", "/about"],
  ["Contact", "/contact"],
  ["Editorial Policy", "/editorial-policy"],
  ["Corrections Policy", "/corrections-policy"],
  ["Privacy Policy", "/privacy"],
  ["Terms of Use", "/terms"],
  ["Disclaimer", "/disclaimer"],
] as const;

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <h2>World News Simply</h2>
          <p>Clear, sourced news briefings written for everyday reading.</p>
        </div>
        <div>
          <h3>Categories</h3>
          {footerCategories.map((category) => (
            <Link key={category} href={`/?category=${category}`}>{category}</Link>
          ))}
        </div>
        <div>
          <h3>Publication</h3>
          {trustLinks.map(([label, href]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </div>
      </div>
      <p className="copyright">© {new Date().getUTCFullYear()} World News Simply. All rights reserved.</p>
    </footer>
  );
}
