import Link from "next/link";
import SearchModal from "@/components/SearchModal";

export default function Navbar({
  categories,
  activeCategory,
}: {
  categories: string[];
  activeCategory: string;
}) {
  return (
    <header className="site-header">
      <div className="top-accent" />
      <nav className="site-navbar" aria-label="Main navigation">
        <div className="site-navbar-inner">
          <Link href="/" className="brand-logo" aria-label="World News Simply home">
            World News Simply
          </Link>
          <div className="desktop-nav">
            {categories.map((category) => (
              <Link
                key={category}
                href={category === "All" ? "/" : `/?category=${category}`}
                className={activeCategory === category ? "nav-link nav-link-active" : "nav-link"}
              >
                {category === "All" ? "Home" : category}
              </Link>
            ))}
          </div>
          <div className="nav-actions">
            <SearchModal />
          </div>
        </div>
      </nav>
    </header>
  );
}
